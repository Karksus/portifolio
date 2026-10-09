// Hardening (Break Your Own Site): trim whitespace-only input before validation
// and stop double submissions. Works without any framework; the form itself is
// plain HTML so it still posts fine if this script never runs (see noscript note).
(function () {
  var form = document.querySelector('form[name="contact"]');
  if (!form) return;
  form.addEventListener('input', function (e) {
    var el = e.target;
    if (!el.name || el.name === 'bot-field') return;
    var v = el.value.replace(/^\s+|\s+$/g, '');
    if (v !== el.value) el.value = v;
  });
  form.addEventListener('submit', function () {
    var btn = form.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Sending…';
    }
  });
})();
