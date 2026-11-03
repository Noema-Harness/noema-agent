import { type RefObject, useEffect } from 'react';

export function useScrollActivity(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const timers = new Map<Element, number>();
    const mark = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const element = event.target;
      window.clearTimeout(timers.get(element));
      element.classList.add('scroll-active');
      timers.set(
        element,
        window.setTimeout(() => {
          element.classList.remove('scroll-active');
          timers.delete(element);
        }, 900),
      );
    };
    container.addEventListener('scroll', mark, true);
    return () => {
      container.removeEventListener('scroll', mark, true);
      for (const [element, timer] of timers) {
        window.clearTimeout(timer);
        element.classList.remove('scroll-active');
      }
    };
  }, [containerRef]);
}
