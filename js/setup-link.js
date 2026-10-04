(function(){
  var url = new URL('setup.html', location.href).href;
  var label = document.getElementById('setup-url'); if (label) label.textContent = url;
  var btn = document.getElementById('copy-setup-link');
  if (btn) btn.addEventListener('click', function(){
    if (navigator.clipboard) navigator.clipboard.writeText(url);
    btn.textContent = 'Link copied ✓';
    setTimeout(function(){ btn.textContent = 'Copy guide link'; }, 1600);
  });
})();
