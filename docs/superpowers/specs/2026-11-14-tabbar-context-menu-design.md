# TabBar Context Menu Design

## Intent & Why
Chuột phải lên thanh tab (`TabBar`) hiện chưa chặn sự kiện `contextmenu` mặc định nên đang hiện menu của Chromium/Electron (`Back`, `Forward`, `Reload`, `Inspect Element`). Mục tiêu là thay bằng `ContextMenu` chuẩn Material 3 Expressive cho cả hai ngữ cảnh: thao tác trên từng tab và thao tác chung trên vùng trống của thanh tab.

## Goals, Non-Goals & Anti-Goals
- **Goals:**
  - Chuột phải lên một tab mở menu gồm: `Pin tab` / `Unpin tab`, `Close tab`, `Close Others`.
  - Tab được pin dồn sang đầu bên trái danh sách tab, giữ nguyên tên tab, hiện icon ghim và ẩn nút `×` đóng nhanh.
  - `Close Others` giữ lại tab đang chọn và toàn bộ các tab đã pin, chỉ đóng các tab thường khác.
  - Chuột phải lên vùng trống của tab bar mở menu gồm: `About` (hiện hộp thoại thông tin app) và `Quit` (thoát app).
- **Non-Goals:**
  - Kéo-thả sắp xếp thứ tự tab hoặc lưu trạng thái pin qua các phiên khởi động lại.
  - Các thao tác tab nâng cao khác (`Duplicate tab`, `Close tabs to the right`, `Reopen closed tab`).
- **Anti-Goals:**
  - Không dùng native Electron menu làm lệch giao diện Material 3 Expressive.
  - Không để 2 `ContextMenu` mở cùng lúc khi chuyển chuột phải giữa vùng file và thanh tab.

## Constraints
- Dùng lại `ContextMenu` (`@bug-on/m3-expressive` `VerticalMenu`) và `Dialog` hiện có trong codebase.
- `Close tab` chỉ đóng được khi còn nhiều hơn 1 tab (nhất quán với `canClose = tabs.length > 1` hiện tại của `TabBar`).
- Đảm bảo type-safe cho cả môi trường Electron (`electron/preload.ts`) và fallback nếu chạy web/Tauri (`window.electron?.quitApp?.()` hoặc `window.close()`).

## Approaches Considered
1. **Hướng 1 — Dùng chung `ContextMenu` ở `App.tsx` (Đã chọn):**
   Mở rộng state `contextMenu` ở `App.tsx` thành discriminated union (`file` | `tab` | `tabbar`), truyền `onTabContextMenu` và `onTabBarContextMenu` xuống `TabBar`. Logic `togglePinTab` / `closeOtherTabs` đặt trong helper thuần để dễ unit test.
   - *Trade-off:* `App.tsx` thêm phần dựng `menuItems` cho tab/tabbar, nhưng đảm bảo chỉ có duy nhất một `ContextMenu` toàn cục và đồng bộ với pattern dialog hiện tại.
2. **Hướng 2 — `TabBar` tự quản lý `ContextMenu` và `AboutDialog` riêng:**
   `TabBar.tsx` tự giữ state menu và render `<ContextMenu />` cục bộ.
   - *Trade-off:* Giữ `App.tsx` gọn hơn nhưng tạo 2 `ContextMenu` độc lập dễ xung đột và đẩy logic app-level (`About`, `Quit`) vào component UI thuần.
3. **Native Electron `Menu` (Loại):**
   Lệch hoàn toàn khỏi theme Material 3 Expressive.

## Design Details
- **State & Helpers (`src/utils/navigationHistory.ts` & `src/components/TabBar.tsx`):**
  - Thêm `pinned?: boolean` vào `Tab` (`TabBar.tsx`) và `TabState` (`App.tsx`).
  - `togglePinTab(tabs, id)`: đảo `pinned` của tab mục tiêu và sắp xếp các tab `pinned` lên trước, giữ nguyên thứ tự tương đối trong từng nhóm.
  - `closeOtherTabs(tabs, activeTabId, keepId, terminalCwd)`: giữ lại tab `keepId` và mọi tab có `pinned === true`; cập nhật `activeTabId` sang `keepId` nếu tab đang active bị đóng.
- **TabBar UI (`src/components/TabBar.tsx`):**
  - Gắn `onContextMenu` lên từng `Button[role="tab"]` (gọi `e.preventDefault(); e.stopPropagation(); onTabContextMenu(e, tab)`) và lên vùng `tablist` / container tab bar (gọi `e.preventDefault(); onTabBarContextMenu(e)`).
  - Tab có `tab.pinned === true`: vẫn giữ nguyên tên tab (`tab.title`), hiển thị icon `keep` nhỏ (hoặc badge) để nhận biết đang pin và ẩn nút `×`.
- **ContextMenu Items (`src/App.tsx`):**
  - `kind: 'tab'`:
    - `Pin tab` / `Unpin tab` (`icon: 'keep'`)
    - `Close tab` (`icon: 'close'`, chỉ hiện hoặc kích hoạt khi `tabs.length > 1`)
    - `Close Others` (`icon: 'tab_close'`, chỉ hiện khi có ít nhất 1 tab thường khác có thể đóng)
  - `kind: 'tabbar'`:
    - `About` (`icon: 'info'`, mở `AboutDialog`)
    - `Quit` (`icon: 'power_settings_new'` hoặc `'close'`, gọi `api?.quitApp?.()`)
- **About & Quit (`src/components/AboutDialog.tsx`, `electron/main.ts`, `electron/preload.ts`):**
  - `AboutDialog`: `Dialog` của `@bug-on/m3-expressive` hiển thị tên app (`Materials`), phiên bản (`0.1.0`), và mô tả ngắn.
  - Electron IPC: thêm `ipcMain.handle('app:quit', () => app.quit())` ở `electron/main.ts` và `quitApp: () => ipcRenderer.invoke('app:quit')` ở `electron/preload.ts` (cập nhật type `ElectronAPI` nếu có).

## Left to the Builder
- Kiểm tra icon name chính xác có sẵn trong `Icon.tsx` / Material Symbols (`keep`, `info`, `tab_close`, `close`, v.v.).
- Kiểm tra interface type của `window.electron` trong `src/` để khai báo `quitApp` đầy đủ, không lỗi TypeScript.
- Viết unit test cho `togglePinTab`, `closeOtherTabs`, và render/contextmenu của `TabBar` trong test suite hiện có.

