import React, { type SVGProps } from 'react';
import {
  IconActivity,
  IconArchive,
  IconArrowForwardUp,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconBell,
  IconCheck,
  IconCopy,
  IconDownload,
  IconFolder,
  IconFolderOpen,
  IconLayoutSidebar,
  IconMaximize,
  IconMessages,
  IconMinus,
  IconNotebook,
  IconPaperclip,
  IconPencil,
  IconPlayerStop,
  IconPlus,
  IconQuote,
  IconRefresh,
  IconRestore,
  IconSearch,
  IconSettings,
  IconUserPlus,
  IconUsers,
  IconX,
} from '@tabler/icons-react';

export type NoemaIconName =
  | 'plus'
  | 'users'
  | 'user-add'
  | 'search'
  | 'send'
  | 'settings'
  | 'noema'
  | 'project'
  | 'archive'
  | 'attach'
  | 'arrow'
  | 'copy'
  | 'edit'
  | 'download'
  | 'quote'
  | 'forward'
  | 'thread'
  | 'refresh'
  | 'check'
  | 'back'
  | 'menu'
  | 'close'
  | 'stop'
  | 'activity'
  | 'memory'
  | 'reminder'
  | 'minus'
  | 'maximize'
  | 'restore'
  | 'folder-open';

type NoemaIconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: NoemaIconName;
  size?: number;
};

export function NoemaIcon({
  name,
  size = 18,
  strokeWidth = 1.75,
  className,
  ...props
}: NoemaIconProps) {
  const iconProps = {
    ...props,
    className: ['noema-icon', className].filter(Boolean).join(' '),
    size,
    stroke: strokeWidth,
    'aria-hidden': props['aria-hidden'] ?? true,
  };
  switch (name) {
    case 'plus':
      return <IconPlus {...iconProps} />;
    case 'users':
      return <IconUsers {...iconProps} />;
    case 'user-add':
      return <IconUserPlus {...iconProps} />;
    case 'search':
      return <IconSearch {...iconProps} />;
    case 'send':
      return <IconArrowUp {...iconProps} />;
    case 'project':
      return <IconFolder {...iconProps} />;
    case 'archive':
      return <IconArchive {...iconProps} />;
    case 'attach':
      return <IconPaperclip {...iconProps} />;
    case 'arrow':
      return <IconArrowRight {...iconProps} />;
    case 'copy':
      return <IconCopy {...iconProps} />;
    case 'edit':
      return <IconPencil {...iconProps} />;
    case 'download':
      return <IconDownload {...iconProps} />;
    case 'quote':
      return <IconQuote {...iconProps} />;
    case 'forward':
      return <IconArrowForwardUp {...iconProps} />;
    case 'thread':
      return <IconMessages {...iconProps} />;
    case 'refresh':
      return <IconRefresh {...iconProps} />;
    case 'check':
      return <IconCheck {...iconProps} />;
    case 'back':
      return <IconArrowLeft {...iconProps} />;
    case 'menu':
      return <IconLayoutSidebar {...iconProps} />;
    case 'close':
      return <IconX {...iconProps} />;
    case 'stop':
      return <IconPlayerStop {...iconProps} />;
    case 'activity':
      return <IconActivity {...iconProps} />;
    case 'memory':
      return <IconNotebook {...iconProps} />;
    case 'reminder':
      return <IconBell {...iconProps} />;
    case 'settings':
      return <IconSettings {...iconProps} />;
    case 'minus':
      return <IconMinus {...iconProps} />;
    case 'maximize':
      return <IconMaximize {...iconProps} />;
    case 'restore':
      return <IconRestore {...iconProps} />;
    case 'folder-open':
      return <IconFolderOpen {...iconProps} />;
    case 'noema':
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={['noema-icon', className].filter(Boolean).join(' ')}
          {...props}
        >
          <path d="M5 18V9a5 5 0 0 1 10 0v9M9 18V9m10 9V6" />
        </svg>
      );
  }
}
