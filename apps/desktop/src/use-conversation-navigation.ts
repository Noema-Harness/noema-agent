import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

const preferenceKey = 'noema.conversation-navigation.v3';
const minimumWidth = 224;
const maximumWidth = 400;
const collapseThreshold = 96;

function readPreference(): { width: number; collapsed: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null');
    return {
      width:
        Number.isFinite(value?.width) && value.width >= minimumWidth
          ? Math.min(value.width, maximumWidth)
          : 232,
      collapsed: value?.collapsed === true,
    };
  } catch {
    return { width: 232, collapsed: false };
  }
}

export function useConversationNavigation() {
  const [preference, setPreference] = useState(readPreference);
  const [availableWidth, setAvailableWidth] = useState(window.innerWidth);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    element: HTMLDivElement;
    pointerId: number;
    startX: number;
    width: number;
    initial: typeof preference;
    current: typeof preference;
  } | null>(null);
  const narrow = availableWidth <= 700;
  const widthLimit = Math.min(
    maximumWidth,
    Math.max(minimumWidth, availableWidth - 420),
  );
  const width = Math.min(preference.width, widthLimit);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const savePreference = useCallback((value: typeof preference) => {
    setPreference(value);
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(value));
    } catch {
      // Navigation remains usable when browser storage is unavailable.
    }
  }, []);

  const finishDrag = useCallback(
    (cancel = false) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      savePreference(cancel ? drag.initial : drag.current);
      setDragging(false);
      if (drag.element.hasPointerCapture(drag.pointerId)) {
        drag.element.releasePointerCapture(drag.pointerId);
      }
      if (!cancel && drag.current.collapsed) {
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLButtonElement>('.navigation-reveal')
            ?.focus(),
        );
      }
    },
    [savePreference],
  );

  useEffect(() => {
    if (!dragging) return;
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      finishDrag(true);
    };
    const blur = () => finishDrag(true);
    window.addEventListener('keydown', cancel);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', cancel);
      window.removeEventListener('blur', blur);
    };
  }, [dragging, finishDrag]);

  // Entering the drawer layout cancels a desktop drag instead of saving a
  // narrow-window constraint as the user's preferred desktop width.
  useEffect(() => {
    if (narrow) finishDrag(true);
  }, [narrow, finishDrag]);

  const reveal = useCallback(() => {
    setPreference((current) => {
      const next = { ...current, collapsed: false };
      try {
        localStorage.setItem(preferenceKey, JSON.stringify(next));
      } catch {
        // The current window can still reveal its navigation.
      }
      return next;
    });
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (narrow || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      element: event.currentTarget,
      pointerId: event.pointerId,
      startX: event.clientX,
      width,
      initial: preference,
      current: preference,
    };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const candidate = drag.width + event.clientX - drag.startX;
      const collapsed = candidate < collapseThreshold;
      drag.current = {
        // Collapsing preserves the width from the start of the gesture.
        width: collapsed
          ? drag.initial.width
          : Math.min(widthLimit, Math.max(minimumWidth, candidate)),
        collapsed,
      };
      setPreference(drag.current);
    };
    const release = (event: globalThis.PointerEvent) => {
      if (event.pointerId === dragRef.current?.pointerId) finishDrag();
    };
    const cancel = (event: globalThis.PointerEvent) => {
      if (event.pointerId === dragRef.current?.pointerId) finishDrag(true);
    };
    // The handle can move or become hidden during collapse. Complete the
    // gesture even when the final event is targeted at the conversation.
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', cancel, true);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', cancel, true);
    };
  }, [dragging, widthLimit, finishDrag]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)
    ) {
      return;
    }
    event.preventDefault();
    if (event.key === 'Home' || event.key === 'Enter') {
      savePreference({ ...preference, collapsed: true });
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>('.navigation-reveal')
          ?.focus(),
      );
      return;
    }
    savePreference({
      width:
        event.key === 'End'
          ? widthLimit
          : Math.min(
              widthLimit,
              Math.max(
                minimumWidth,
                width +
                  (event.key === 'ArrowLeft' ? -1 : 1) *
                    (event.shiftKey ? 32 : 16),
              ),
            ),
      collapsed: false,
    });
  };

  return {
    containerRef,
    narrow,
    collapsed: preference.collapsed,
    dragging,
    width,
    widthLimit,
    style: { '--conversation-sidebar-width': `${width}px` } as CSSProperties,
    reveal,
    collapse: () => savePreference({ ...preference, collapsed: true }),
    separatorProps: {
      onPointerDown,
      onKeyDown,
    },
  };
}
