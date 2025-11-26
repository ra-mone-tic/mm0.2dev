export const THEMES = ['minimal','neon','test','test2'];
export const DEFAULT_THEME = 'minimal';

export function setTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  try{ localStorage.setItem('meowmap-theme', t); }catch(e){ /* ignore */ }
  const logo = document.getElementById('logo');
  if(logo){
    logo.src = (t === 'neon') ? 'assets/logo1.png' : 'assets/Vector.png';
  }
}
export function getTheme(){
  try{ return localStorage.getItem('meowmap-theme') || DEFAULT_THEME; }catch(e){ return DEFAULT_THEME; }
}
export function nextTheme(t){
  const i = THEMES.indexOf(t);
  return THEMES[(i+1) % THEMES.length];
}

setTheme(getTheme());

const btn = document.getElementById('themeToggle') || document.getElementById('logo');
if(btn){
  btn.addEventListener('click', ()=> setTheme(nextTheme(getTheme())));
}
