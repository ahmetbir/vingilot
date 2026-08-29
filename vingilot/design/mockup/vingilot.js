const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const KEY='vingilot-mockup-v2';
let state={};try{state=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
function setSide(v){state.side=v;document.body.dataset.side=v;const m={buzz:['#4a4616','#0a1423'],graphite:['#2c2c30','#1a1a1e'],slate:['#2a3240','#10151d'],ink:['#161616','#161616'],ember:['#4a2e16','#140e0a']}[v];document.body.style.setProperty('--side-top',m[0]);document.body.style.setProperty('--side-bottom',m[1]);$$('.sq[data-side]').forEach(b=>b.classList.toggle('on',b.dataset.side===v));save()}
function setAccent(v){state.accent=v;const m={ember:['#e0a35f','#eebc80'],orange:['#ff6b35','#ff9c6e'],mauve:['#c6a0f6','#d6bcf9'],teal:['#7fb2c9','#a3cbdc'],green:['#8fb97c','#aacd9a']}[v];document.body.style.setProperty('--accent',m[0]);document.body.style.setProperty('--accent-text',m[1]);document.body.style.setProperty('--accent-soft',m[0]+'24');$$('.sq[data-accent]').forEach(b=>b.classList.toggle('on',b.dataset.accent===v));save()}
function setChat(v){state.chat=v;document.body.dataset.chat=v;$$('[data-chatpos]').forEach(b=>b.classList.toggle('on',b.dataset.chatpos===v));save()}
function setView(v){state.view=v;$$('.view').forEach(el=>el.classList.toggle('on',el.id==='view-'+v));$$('.srow[data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===v));save()}
function setDock(v){state.dock=v;$$('.dpanel').forEach(el=>el.classList.toggle('on',el.id==='dp-'+v));$$('.dtab[data-dock]').forEach(b=>b.classList.toggle('on',b.dataset.dock===v));save()}
let toastT;function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('on'),1800)}
function palette(on){$('#palette').classList.toggle('on',on);$('#overlay').classList.toggle('on',on);if(on){$('#pinput').value='';$('#pinput').focus()}}
function tray(on){$('#tray').classList.toggle('on',on===undefined?!$('#tray').classList.contains('on'):on);$('#btn-appearance').classList.toggle('on',$('#tray').classList.contains('on'))}
document.addEventListener('click',e=>{
const t=e.target.closest('[data-side],[data-accent],[data-chatpos],[data-view],[data-dock],[data-act],[data-tf],[data-reviewer],[data-pr],[data-hm],[data-term],[data-dm]');
if(!$('#tray').contains(e.target)&&!e.target.closest('#btn-appearance'))tray(false);
const fr=e.target.closest('.trow:not([data-tf])');
if(fr){$$('.trow.sel').forEach(x=>x.classList.remove('sel'));fr.classList.add('sel')}
if(!t)return;
if(t.dataset.tf){t.classList.toggle('closed');const k=document.getElementById(t.dataset.tf);if(k)k.style.display=t.classList.contains('closed')?'none':'';return}
if(t.dataset.side)setSide(t.dataset.side);
if(t.dataset.accent)setAccent(t.dataset.accent);
if(t.dataset.chatpos)setChat(t.dataset.chatpos);
if(t.dataset.view)setView(t.dataset.view);
if(t.dataset.dock)setDock(t.dataset.dock);
const a=t.dataset.act;
if(a==='palette')palette(true);
if(t.dataset.dm){const d=t.dataset.dm,mate=d==='mate';$('#dmsheet').classList.add('on');$('#dmpill').classList.remove('on');$('#dmname').textContent=mate?'Mate':'luna';$('#dmav').textContent=mate?'M':'lu';$('#dmav').style.background=mate?'linear-gradient(140deg,#6b5a8a,#3a3050)':'linear-gradient(140deg,#3e5a7a,#1e3050)';$('#dmpres').textContent=mate?'first mate · only you can read this':'online · buzz';$('#dmph').textContent='Message '+(mate?'Mate':'luna');$('#dmb-mate').style.display=mate?'':'none';$('#dmb-luna').style.display=mate?'none':'';$('#dmpillname').textContent=mate?'Mate':'luna';$('#dmpillav').textContent=mate?'M':'lu';$('#dmpillav').style.background=$('#dmav').style.background}
if(a==='dm-min'){$('#dmsheet').classList.remove('on');$('#dmpill').classList.add('on')}
if(a==='dm-close'){$('#dmsheet').classList.remove('on');$('#dmpill').classList.remove('on')}
if(a==='dm-restore'){$('#dmpill').classList.remove('on');$('#dmsheet').classList.add('on')}
if(t.dataset.term){$$('[data-term]').forEach(b=>b.classList.toggle('on',b.dataset.term===t.dataset.term));$('#tb-claude').style.display=t.dataset.term==='claude'?'':'none';$('#tb-scratch').style.display=t.dataset.term==='scratch'?'':'none'}
if(a==='scratch-close'){$('#tab-scratch').style.display='none';$$('[data-term]').forEach(b=>b.classList.toggle('on',b.dataset.term==='claude'));$('#tb-claude').style.display='';$('#tb-scratch').style.display='none';toast('Scratch terminal closed — nothing kept');return}
if(a==='scratch'){palette(false);$('#tab-scratch').style.display='';$$('[data-term]').forEach(b=>b.classList.toggle('on',b.dataset.term==='scratch'));$('#tb-claude').style.display='none';$('#tb-scratch').style.display='';toast('Scratch terminal — gone when you close it')}
if(a==='toggle-side'){palette(false);document.body.classList.toggle('noside');state.noside=document.body.classList.contains('noside');save()}
if(a==='zen'){palette(false);document.body.classList.toggle('zen');state.zen=document.body.classList.contains('zen');save()}
if(a==='close-palette'&&t.dataset.msg)toast(t.dataset.msg);
if(a==='close-palette')palette(false);
if(a==='tray'){e.stopPropagation();tray()}
if(a==='toast')toast(t.dataset.msg||'Done');
if(t.dataset.hm){$$('.hseg button').forEach(b=>b.classList.toggle('on',b===t));$('#hist-graph').style.display=t.dataset.hm==='graph'?'':'none';$('#hist-reflog').style.display=t.dataset.hm==='reflog'?'block':'none'}
if(a==='pr-back'){$('#pr-detail').style.display='none';$('#pr-list').style.display='';}
if(t.dataset.pr){$('#pr-list').style.display='none';$('#pr-detail').style.display='';}
if(a==='review'){e.stopPropagation();$('#revpop').classList.toggle('on')}
if(t.dataset.reviewer){state.reviewer=t.dataset.reviewer;$$('.ragent').forEach(b=>b.classList.toggle('on',b.dataset.reviewer===t.dataset.reviewer));save()}
if(a==='rev-reset'){$('#rtext').value=REV_DEFAULT;state.revtext=undefined;save()}
if(a==='rev-start'){$('#revpop').classList.remove('on');toast((state.reviewer||'Lookout')+' started reviewing PR #412')}
});
document.addEventListener('keydown',e=>{
if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();palette(!$('#palette').classList.contains('on'))}
if((e.metaKey||e.ctrlKey)&&e.key==='\\'){e.preventDefault();setChat(document.body.dataset.chat==='float'?'right':'float')}
if(e.key==='Escape'){palette(false);tray(false);$('#revpop').classList.remove('on');if(document.body.dataset.chat==='float')setChat('right')}
if((e.metaKey||e.ctrlKey)&&e.key==='1'){e.preventDefault();setView('deck')}
if((e.metaKey||e.ctrlKey)&&e.key==='2'){e.preventDefault();setView('agents')}
if((e.metaKey||e.ctrlKey)&&e.key==='3'){e.preventDefault();setView('inbox')}
});
$('#overlay').addEventListener('click',()=>palette(false));
const REV_DEFAULT=$('#rtext').value;
$('#rtext').addEventListener('input',()=>{state.revtext=$('#rtext').value;save()});
if(state.revtext)$('#rtext').value=state.revtext;
if(state.reviewer)$$('.ragent').forEach(b=>b.classList.toggle('on',b.dataset.reviewer===state.reviewer));
document.addEventListener('click',e=>{if(!$('#revpop').contains(e.target)&&!e.target.closest('#btn-review'))$('#revpop').classList.remove('on')});
const ctxEl=$('#ctx');
document.addEventListener('contextmenu',e=>{
const r=e.target.closest('.trow');
if(!r){ctxEl.classList.remove('on');return}
e.preventDefault();
const nm=r.querySelector('.tname').textContent;
$('#ctxpath').textContent=(r.dataset.tf?'~/self-hosted/buzz/':'~/self-hosted/buzz/…/')+nm;
ctxEl.classList.add('on');
const w=ctxEl.offsetWidth,h=ctxEl.offsetHeight;
ctxEl.style.left=Math.min(e.clientX,innerWidth-w-8)+'px';
ctxEl.style.top=Math.min(e.clientY,innerHeight-h-8)+'px';
});
document.addEventListener('click',()=>ctxEl.classList.remove('on'));
document.addEventListener('keydown',e=>{if(e.key==='Escape')ctxEl.classList.remove('on')});
const rz=$('#rz');let dragging=false;
rz.addEventListener('mousedown',e=>{dragging=true;rz.classList.add('drag');e.preventDefault()});
window.addEventListener('mousemove',e=>{if(!dragging)return;const w=Math.min(340,Math.max(196,e.clientX-6));document.body.style.setProperty('--sidew',w+'px');state.sidew=w});
window.addEventListener('mouseup',()=>{if(dragging){dragging=false;rz.classList.remove('drag');save()}if(dragging2){dragging2=false;rz2.classList.remove('drag');save()}});
if(state.sidew)document.body.style.setProperty('--sidew',state.sidew+'px');
const rz2=$('#rz2');let dragging2=false,dockRight=0,dockBottom=0,drawerMode=false;
rz2.addEventListener('mousedown',e=>{dragging2=true;rz2.classList.add('drag');const r=document.querySelector('.dock').getBoundingClientRect();dockRight=r.right;dockBottom=r.bottom;drawerMode=document.body.dataset.chat==='drawer';e.preventDefault()});
window.addEventListener('mousemove',e=>{if(!dragging2)return;if(drawerMode){const h=Math.min(480,Math.max(170,dockBottom-e.clientY));document.body.style.setProperty('--dockh',h+'px');state.dockh=h}else{const w=Math.min(540,Math.max(300,dockRight-e.clientX));document.body.style.setProperty('--dockw',w+'px');state.dockw=w}});
if(state.dockw)document.body.style.setProperty('--dockw',state.dockw+'px');
if(state.dockh)document.body.style.setProperty('--dockh',state.dockh+'px');
if(state.noside)document.body.classList.add('noside');
if(state.zen)document.body.classList.add('zen');
document.addEventListener('keydown',e=>{
if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='b'&&!e.altKey){e.preventDefault();document.body.classList.toggle('noside');state.noside=document.body.classList.contains('noside');save()}
if((e.metaKey||e.ctrlKey)&&e.altKey&&e.code==='KeyB'){e.preventDefault();document.body.classList.toggle('zen');state.zen=document.body.classList.contains('zen');save()}
});
setSide(state.side||'buzz');setAccent(state.accent||'ember');setChat(state.chat||'right');setView(state.view||'deck');setDock(state.dock||'crew');
