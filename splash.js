// Splash screen: shown on start, dismissed by click/key, reopened via the logo in the menu bar.
const splash = document.getElementById('splash');

function show() {
  splash.hidden = false;
  requestAnimationFrame(() => splash.classList.remove('hide'));
}

function hide() {
  splash.classList.add('hide');
  setTimeout(() => { if (splash.classList.contains('hide')) splash.hidden = true; }, 450);
}

splash.addEventListener('click', hide);
addEventListener('keydown', e => { if (!splash.hidden && !splash.classList.contains('hide')) { hide(); e.stopPropagation(); } }, true);
document.getElementById('logoBtn').addEventListener('click', show);
show();
