# TabBar Button Icon Refactor Design

## Intent
Chuẩn hóa `Button` của `@bug-on/m3-expressive` trong `src/components/TabBar.tsx` để sử dụng prop `icon` gốc của thư viện cho icon dẫn đầu thay vì tự bọc `<Icon>` rời rạc trong `children`.

## Goals & Non-Goals
- **Goals:**
  - Dùng prop `icon` và `iconPosition="leading"` trên `Button` cho icon loại tab (`getTabIconName(tab.path)`).
  - Giữ nguyên hiệu ứng `fill={isActive ? 1 : 0}` và `animateFill`, cũng như layout `truncate` cho tiêu đề và phần trailing (`keep` / nút `close`).
- **Non-Goals:**
  - Không chỉnh sửa `@bug-on/m3-expressive` hay wrapper `src/components/Button.tsx`.
  - Không thay đổi `ButtonGroup variant="connected"`, điều hướng bàn phím, middle-click đóng tab, hay context menu.

## Constraints
- `Button` (`BaseButtonProps` trong `@bug-on/m3-expressive`) chỉ hỗ trợ một slot `icon` duy nhất (`icon`, `selectedIcon`, `iconPosition?: "leading" | "trailing"`), không có hai props `leadingIcon` và `trailingIcon` tách riêng.
- Nút đóng tab là một trigger tương tác riêng (`role="button"`, `onPointerDown`, `onClick` chặn propagation) và không được lồng `<button>` bên trong `<button>`.

## Approaches Considered
1. **Dùng `icon` cho icon bên trái (`iconPosition="leading"`), giữ phần trailing (`keep` / nút `close`) trong `children` *(đã chọn)*:** Tận dụng slot `icon` chuẩn của `Button` cho icon hiển thị thuần túy bên trái, trong khi vẫn giữ nút đóng `role="button"` độc lập và icon `keep` ở phía phải.
2. **Dùng `icon` cho phần trailing (`iconPosition="trailing"`):** Không phù hợp vì nút đóng cần xử lý sự kiện riêng và `role="button"`.
3. **Tách nút đóng ra ngoài `Button`:** Phá vỡ cấu trúc item đồng nhất của `ButtonGroup variant="connected"`.

## Planned Changes
- `src/components/TabBar.tsx`:
  - Truyền `icon={<Icon name={getTabIconName(tab.path)} size={16} fill={isActive ? 1 : 0} animateFill />}` và `iconPosition="leading"` vào `<Button>`.
  - Đơn giản hóa `children` của `<Button>`: bỏ wrapper dẫn đầu, giữ `<span className="flex items-center gap-1.5 w-full min-w-0 justify-between">` chứa `<span className="truncate flex-1 text-left">{tab.title}</span>` và phần trailing (`keep` / nút `close`).
- `src/components/__tests__/uiStandardization.test.tsx`:
  - Bổ sung kiểm chứng `TabBar` render icon dẫn đầu qua slot icon của `Button` cùng `tab.title` và phần trailing đúng cấu trúc.

