(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = api;
  }
  root.SehenShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const EASY_SECONDS = 3;
  const GOOD_SECONDS = 8;

  function canonicalizeAnswer(input) {
    return String(input || '')
      .trim()
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/\s+/g, ' ');
  }

  function gradeFromResponseTime(seconds) {
    if (seconds <= EASY_SECONDS) return 4;
    if (seconds <= GOOD_SECONDS) return 3;
    return 2;
  }

  return {
    EASY_SECONDS,
    GOOD_SECONDS,
    canonicalizeAnswer,
    gradeFromResponseTime,
  };
});
