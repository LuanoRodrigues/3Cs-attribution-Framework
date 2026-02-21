(function initVirtualList() {
  function computeWindow({ total, rowHeight, scrollTop, viewportHeight, overscan = 6 }) {
    const safeTotal = Math.max(0, Number(total || 0));
    const h = Math.max(1, Number(rowHeight || 1));
    const top = Math.max(0, Number(scrollTop || 0));
    const vp = Math.max(1, Number(viewportHeight || 1));
    if (safeTotal === 0) {
      return {
        start: 0,
        end: 0,
        offsetTop: 0,
        totalHeight: 0
      };
    }

    const visibleCount = Math.ceil(vp / h) + overscan * 2;
    const unclampedFirst = Math.max(0, Math.floor(top / h) - overscan);
    const maxFirst = Math.max(0, safeTotal - visibleCount);
    const first = Math.min(unclampedFirst, maxFirst);
    const end = Math.min(safeTotal, first + visibleCount);
    return {
      start: first,
      end,
      offsetTop: first * h,
      totalHeight: safeTotal * h
    };
  }

  window.ZoteroVirtualList = {
    computeWindow
  };
})();
