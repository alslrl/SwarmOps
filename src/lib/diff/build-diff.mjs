export function buildDiff(before, after) {
  return {
    title: { before: before.title, after: after.title },
    top_copy: { before: before.top_copy, after: after.top_copy },
    price: { before: before.price_krw, after: after.price_krw },
  };
}
