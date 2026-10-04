var S=[
{t:'Open GitSync & install it (optional)',m:'1 min',i:['Open GitSync in <b>Chrome</b> (Android) or <b>Safari</b> (iPhone).','<b>Android:</b> tap the ⋮ menu → <b>Install app</b> / <b>Add to Home screen</b>.','<b>iPhone:</b> tap <b>Share</b> → <b>Add to Home Screen</b>.','Open GitSync from your home screen like a normal app.']},
{t:'Sign in to GitHub',m:'1 min',i:['Go to <b>github.com</b>.','Tap <b>Sign in</b>, or <b>Sign up</b> if you don\'t have an account yet (free).'],b:['Open github.com','https://github.com/login']},
{t:'Create your access token',m:'2 min',i:['On GitHub tap your <b>profile photo</b> → <b>Settings</b>.','Scroll down the left menu → <b>Developer settings</b>.','Tap <b>Personal access tokens</b> → <b>Tokens (classic)</b>.','Tap <b>Generate new token</b> → <b>Generate new token (classic)</b>.','Name it <b>GitSync</b> and choose an expiry.','Tick the <b>repo</b> checkbox (nothing else is needed).','Scroll down and tap <b>Generate token</b>.','<b>Copy the token now</b> — it starts with <code>ghp_</code>.'],w:'GitHub shows the token only once. If you lose it, just generate a new one.',b:['Open pre-filled token page','https://github.com/settings/tokens/new?scopes=repo&description=GitSync']},
{t:'Connect your account',m:'30 sec',i:['Open GitSync\'s login screen.','Paste the token into <b>GitHub Personal Access Token</b>.','Tap <b>Connect to GitHub</b>.'],p:'GitSync remembers you on this device. Add more accounts later from Settings → Connected Accounts.'},
{t:'Choose repository & branch',m:'30 sec',i:['On <b>Home</b>, tap the <b>Repository</b> field and pick one.','Tap <b>Branch</b> to choose a branch (or <b>+ Create new branch</b>).','Leave <b>Sync Mode</b> on <i>Selected folder only</i> if unsure — it never deletes other files.']},
{t:'Upload your project',m:'1 min',i:['Tap <b>Upload ZIP File</b> (or <b>Upload Project Folder</b>) and pick your project.','Review the list: <b>Added</b>, <b>Modified</b>, <b>Deleted</b>.','Tap <b>Review & Commit</b>, type a message, then <b>Commit Everything</b>.','Wait for the green <b>Pushed successfully</b> page — you\'re done!']},
{t:'Create a repo & publish your site',m:'1 min',i:['Open the <b>Custom</b> tab.','Enter a name, choose <b>Public</b> or <b>Private</b>, and drop in your project ZIP.','Tap <b>Create Repository</b> and wait for the success page.','<b>Public repo:</b> tap <b>Publish with GitHub Pages</b> — your live link is shown and stays saved in Your Repositories.','<b>Private repo:</b> publishing isn\'t available in GitSync. Open it on GitHub → <b>Settings → Pages</b>.'],p:'Pages usually goes live within 1–2 minutes.'}
];
var done=[];try{done=JSON.parse(localStorage.getItem('gitsync-setup')||'[]')}catch(e){}
function render(){var h='';S.forEach(function(s,n){var d=done.indexOf(n)>-1;
h+='<div class="sg-step'+(d?' done':'')+'"><div class="sg-head"><span class="sg-num">'+(d?'✓':n+1)+'</span><div><b>'+s.t+'</b><small>⏱ '+s.m+'</small></div></div><ol class="sg-list">'+s.i.map(function(x){return'<li><span>'+x+'</span></li>'}).join('')+'</ol>'
+(s.w?'<div class="sg-warn">⚠ '+s.w+'</div>':'')+(s.p?'<div class="sg-tip">💡 '+s.p+'</div>':'')
+(s.b?'<a class="btn btn-secondary btn-block" target="_blank" rel="noopener" href="'+s.b[1]+'">'+s.b[0]+' ↗</a>':'')
+'<label class="sg-done"><input type="checkbox" data-n="'+n+'"'+(d?' checked':'')+'> Mark step as done</label></div>'});
document.getElementById('steps').innerHTML=h;var p=Math.round(done.length/S.length*100);
document.getElementById('pl').textContent=done.length+' of '+S.length+' steps done';document.getElementById('pp').textContent=p+'%';document.getElementById('pb').style.width=p+'%'}
document.addEventListener('change',function(e){var n=e.target.dataset&&e.target.dataset.n;if(n==null)return;n=+n;var i=done.indexOf(n);if(e.target.checked&&i<0)done.push(n);if(!e.target.checked&&i>-1)done.splice(i,1);try{localStorage.setItem('gitsync-setup',JSON.stringify(done))}catch(x){}render()});
render();

