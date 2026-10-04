(function(){
  var btn=document.getElementById('refresh'),label=document.getElementById('label'),status=document.getElementById('status');
  function ping(){
    return new Promise(function(resolve){
      var done=false,c=window.AbortController?new AbortController():null;
      var t=setTimeout(function(){if(done)return;done=true;if(c)c.abort();resolve(false);},6000);
      fetch('manifest.json?__ping='+Date.now(),{cache:'no-store',signal:c?c.signal:undefined})
        .then(function(r){if(done)return;done=true;clearTimeout(t);resolve(r.status<500);})
        .catch(function(){if(done)return;done=true;clearTimeout(t);resolve(false);});
    });
  }
  function go(){
    if(/offline\.html$/.test(location.pathname)) location.replace('./index.html'); else location.reload();
  }
  btn.addEventListener('click',function(){
    btn.disabled=true;btn.classList.add('spin');label.textContent='Checking connection\u2026';status.textContent='';status.className='status';
    ping().then(function(ok){
      if(ok){go();return;}
      btn.disabled=false;btn.classList.remove('spin');label.textContent='Refresh';
      status.textContent='Still no connection. Check Wi\u2011Fi or mobile data and try again.';status.className='status err';
    });
  });
  window.addEventListener('online',function(){ping().then(function(ok){if(ok){status.textContent='Connection restored \u2014 tap Refresh.';status.className='status';}});});
})();
