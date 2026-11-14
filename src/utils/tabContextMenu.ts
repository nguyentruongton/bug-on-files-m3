import type { ContextMenuItem } from '../components/ContextMenu';

interface TabContextMenuParams {
  tab: { id: string; pinned?: boolean };
  canClose: boolean;
  hasClosableOthers: boolean;
  onTogglePin: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
}

export function buildTabContextMenuItems({
  tab,
  canClose,
  hasClosableOthers,
  onTogglePin,
  onCloseTab,
  onCloseOthers,
}: TabContextMenuParams): ContextMenuItem[] {
  return [
    {
      label: tab.pinned ? 'Unpin tab' : 'Pin tab',
      icon: 'keep',
      action: onTogglePin,
    },
    ...(canClose
      ? [
          {
            label: 'Close tab',
            icon: 'close',
            action: onCloseTab,
          },
        ]
      : []),
    ...(hasClosableOthers
      ? [
          {
            label: 'Close Others',
            icon: 'tab_close',
            action: onCloseOthers,
          },
        ]
      : []),
  ];
}

interface TabBarContextMenuParams {
  onAbout: () => void;
  onQuit: () => void;
}

export function buildTabBarContextMenuItems({
  onAbout,
  onQuit,
}: TabBarContextMenuParams): ContextMenuItem[] {
  return [
    {
      label: 'About',
      icon: 'info',
      action: onAbout,
    },
    {
      label: 'Quit',
      icon: 'power_settings_new',
      action: onQuit,
    },
  ];
}
