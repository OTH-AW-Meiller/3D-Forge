// Use a local three.js from lib/three/ if present, otherwise the CDN
(function () {
  var local = 'lib/three/';
  var ok = false;
  try {
    var x = new XMLHttpRequest();
    x.open('HEAD', local + 'build/three.module.js', false);
    x.send();
    ok = x.status === 200;
  } catch (e) {}
  var cdn = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
  var base = ok ? local : cdn;
  var el = document.createElement('script');
  el.type = 'importmap';
  el.textContent = JSON.stringify({ imports: {
    'three': base + 'build/three.module.js',
    'three/addons/': base + 'examples/jsm/'
  } });
  document.head.appendChild(el);
})();
