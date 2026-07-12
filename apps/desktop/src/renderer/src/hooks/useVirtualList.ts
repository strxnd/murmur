import { useMemo, useRef, useState, type UIEvent } from "react";

interface VirtualListOptions<T> {
  items: T[];
  rowHeight: number;
  overscan?: number;
}

interface VirtualRow<T> {
  index: number;
  item: T;
  top: number;
}

export function useVirtualList<T>({ items, rowHeight, overscan = 6 }: VirtualListOptions<T>): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  totalHeight: number;
  rows: VirtualRow<T>[];
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
} {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const target = event.currentTarget;
    setScrollTop(target.scrollTop);
    setViewportHeight(target.clientHeight);
  };

  const totalHeight = items.length * rowHeight;
  const rows = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
    const visible: VirtualRow<T>[] = [];
    for (let index = start; index < end; index += 1) {
      visible.push({ index, item: items[index], top: index * rowHeight });
    }
    return visible;
  }, [items, overscan, rowHeight, scrollTop, viewportHeight]);

  return { containerRef, totalHeight, rows, onScroll };
}
