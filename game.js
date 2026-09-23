(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const frame = document.getElementById('gameFrame');
  const overlay = document.getElementById('overlay');
  const overlayContent = document.getElementById('overlayContent');
  const startBtn = document.getElementById('startBtn');
  const hud = document.getElementById('hud');
  const lobbyStatus = document.getElementById('lobbyStatus');
  const playerNameInput = document.getElementById('playerName');
  const roomCodeInput = document.getElementById('roomCode');
  const roomPlayers = new Map();
  const localPlayerId = crypto.randomUUID ? crypto.randomUUID() : `p${Math.random().toString(36).slice(2)}`;
  const playerPalette = ['#d9f45b', '#62d9ff', '#ff8fe1', '#ffb04e'];
  let supabase = null, roomChannel = null, roomCode = '', isRoomHost = false, netSendClock = 0;
  const keys = new Set();
  const pointer = { x: 0, y: 0, down: false };
  let running = false, animationId = 0, lastFrame = 0, elapsed = 0, kills = 0;
  let wave = 1, spawnClock = 0, shotClock = 0, enemyClock = 0, soundOn = true;
  let audio;
  let player, bullets = [], enemies = [], particles = [], pickups = [], rain = [], remoteShots = [];
  let touchMove = { x: 0, y: 0 }, touchFire = false, lastShot = 0;
  const BEST_KEY = 'afterlight-best';
  const bestScore = document.getElementById('bestScore');
  bestScore.textContent = String(Number(localStorage.getItem(BEST_KEY) || 0)).padStart(3, '0');

  const netConfig = window.AFTERLIGHT_CONFIG || {};
  if (window.supabase?.createClient && netConfig.url && netConfig.anonKey) {
    supabase = window.supabase.createClient(netConfig.url, netConfig.anonKey, { realtime: { params: { eventsPerSecond: 15 } } });
    setNetworkStatus('online', '多人連線服務已就緒');
  } else setNetworkStatus('offline', '多人連線尚未設定 · 單人可遊玩');

  function setNetworkStatus(state, message) {
    const box = document.getElementById('connectionState');
    if (box) box.className = `connection-state ${state}`;
    const label = document.getElementById('connectionText'); if (label) label.textContent = message;
  }
  function setLobbyMessage(message) { if (lobbyStatus) lobbyStatus.textContent = message; }
  function normalizedName() { return (playerNameInput.value.trim() || `玩家${Math.floor(100 + Math.random()*900)}`).slice(0,14); }
  function sendRoomEvent(event, payload) { if (roomChannel) roomChannel.send({ type: 'broadcast', event, payload }).catch(() => {}); }
  function playerState() { return { id: localPlayerId, name: normalizedName(), x: player?.x || W()/2, y: player?.y || H()/2, angle: player?.angle || 0, hp: player?.hp ?? 100, color: playerPalette[Array.from(roomPlayers.keys()).indexOf(localPlayerId) % playerPalette.length] || playerPalette[0] }; }
  function syncRoomPresence() {
    if (!roomChannel) return;
    roomPlayers.clear();
    for (const values of Object.values(roomChannel.presenceState())) { const value=values[0]; if(value?.id&&value.id!==localPlayerId)roomPlayers.set(value.id,value); }
    renderRemotePlayers();
    setLobbyMessage(`${roomCode} · ${roomPlayers.size+1}/4 位玩家　${isRoomHost?'你是房主':'已連線'}`);
  }
  async function connectRoom(code, create) {
    if (!supabase) { setLobbyMessage('多人服務尚未設定：需要 Supabase 專案連線資料。'); return; }
    if (roomChannel) await supabase.removeChannel(roomChannel);
    roomCode=code.toUpperCase();isRoomHost=create;roomPlayers.clear();roomCodeInput.value=roomCode;
    setNetworkStatus('connecting','正在連線至房間…');setLobbyMessage('正在建立即時連線…');
    roomChannel=supabase.channel(`afterlight-${roomCode}`,{config:{broadcast:{self:false,ack:false},presence:{key:localPlayerId}}});
    roomChannel.on('presence',{event:'sync'},syncRoomPresence);
    roomChannel.on('broadcast',{event:'state'},({payload})=>{if(payload?.id&&payload.id!==localPlayerId){roomPlayers.set(payload.id,payload);renderRemotePlayers();}});
    roomChannel.on('broadcast',{event:'shot'},({payload})=>{if(payload)remoteShots.push({x:payload.x,y:payload.y,angle:payload.angle,life:.18,color:payload.color});});
    roomChannel.on('broadcast',{event:'start'},()=>{if(!running)start(true);});
    roomChannel.on('broadcast',{event:'enemy'},({payload})=>{if(payload?.kind==='spawn'&&!enemies.some(e=>e.id===payload.id))enemies.push({...payload.enemy,id:payload.id,remote:true});if(payload?.kind==='kill')enemies=enemies.filter(e=>e.id!==payload.id);});
    roomChannel.subscribe(async status=>{if(status==='SUBSCRIBED'){setNetworkStatus('online',`已連線 · 房間 ${roomCode}`);await roomChannel.track(playerState());syncRoomPresence();}else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){setNetworkStatus('offline','連線中斷');setLobbyMessage('連線中斷，請重新建立或加入房間。');}});
  }
  function newRoomCode(){return Math.random().toString(36).slice(2,8).toUpperCase().padEnd(6,'A');}
  document.getElementById('createRoomBtn').addEventListener('click',()=>connectRoom(newRoomCode(),true));
  document.getElementById('joinRoomBtn').addEventListener('click',()=>{const code=roomCodeInput.value.trim().replace(/[^a-z0-9]/gi,'').slice(0,6);if(code.length!==6){setLobbyMessage('請輸入 6 位房間碼。');return;}connectRoom(code,false);});
  roomCodeInput.addEventListener('input',()=>{roomCodeInput.value=roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);});

  function size() {
    const rect = frame.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (player) { player.x = Math.min(rect.width - 24, Math.max(24, player.x)); player.y = Math.min(rect.height - 24, Math.max(24, player.y)); }
    if (!running) drawBackground(0);
  }
  const W = () => frame.clientWidth;
  const H = () => frame.clientHeight;
  const rand = (a, b) => a + Math.random() * (b - a);

  function initScene() {
    const w = W(), h = H();
    rain = Array.from({ length: Math.round(w * h / 4900) }, () => ({ x: rand(0, w), y: rand(0, h), l: rand(9, 24), v: rand(90, 210) }));
    drawBackground(0);
  }

  function drawBackground(dt) {
    const w = W(), h = H();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b100e'; ctx.fillRect(0, 0, w, h);
    const block = 96, offset = (elapsed * 5) % block;
    ctx.lineWidth = 1;
    for (let x = -block + (offset % block); x < w + block; x += block) {
      for (let y = -block + (offset * .55 % block); y < h + block; y += block) {
        ctx.fillStyle = '#0e1512'; ctx.fillRect(x + 6, y + 6, block - 12, block - 12);
        ctx.strokeStyle = '#18211c'; ctx.strokeRect(x + 6.5, y + 6.5, block - 13, block - 13);
        ctx.fillStyle = '#18221c'; ctx.fillRect(x + 17, y + 17, 20, 3);
        ctx.fillStyle = '#121a16'; ctx.fillRect(x + block - 28, y + 21, 9, 9);
        if ((Math.floor(x / block) + Math.floor(y / block)) % 4 === 0) {
          ctx.strokeStyle = '#263429'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(x + 58, y + 62, 13, 0, Math.PI * 1.4); ctx.stroke(); ctx.lineWidth = 1;
        }
      }
    }
    if (!rain.length) return;
    ctx.strokeStyle = '#85968b20'; ctx.lineWidth = 1;
    for (const drop of rain) {
      if (dt) { drop.y += drop.v * dt; drop.x -= drop.v * dt * .13; if (drop.y > h) { drop.y = -drop.l; drop.x = rand(0, w); } }
      ctx.beginPath(); ctx.moveTo(drop.x, drop.y); ctx.lineTo(drop.x - 2, drop.y + drop.l); ctx.stroke();
    }
    const vignette = ctx.createRadialGradient(w/2,h/2,20,w/2,h/2,Math.max(w,h)*.73);
    vignette.addColorStop(0,'#00000000'); vignette.addColorStop(1,'#020605a6'); ctx.fillStyle=vignette;ctx.fillRect(0,0,w,h);
  }

  function start(fromNetwork = false) {
    if (running) return;
    running = true; elapsed = 0; kills = 0; wave = 1; spawnClock = 0; shotClock = 0; enemyClock = 0;
    bullets = []; enemies = []; particles = []; pickups = [];
    remoteShots = [];
    player = { x: W()/2, y: H()/2, angle: 0, hp: 100, invuln: 0, speed: 205 };
    pointer.x = player.x + 100; pointer.y = player.y; pointer.down = false;
    overlay.classList.add('hidden'); hud.classList.remove('hidden');
    document.getElementById('statusText').textContent = 'ENGAGED';
    updateHud();
    lastFrame = performance.now(); animationId = requestAnimationFrame(loop);
    if (soundOn) tone(420, .07, 'sine', .035);
    if (roomChannel && isRoomHost && !fromNetwork) sendRoomEvent('start', { at: Date.now() });
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min((now - lastFrame) / 1000, .04); lastFrame = now; elapsed += dt;
    update(dt); render(dt); updateHud(); animationId = requestAnimationFrame(loop);
  }

  function update(dt) {
    wave = Math.floor(elapsed / 22) + 1;
    const w = W(), h = H();
    let mx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + touchMove.x;
    let my = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0) + touchMove.y;
    const mag = Math.hypot(mx, my); if (mag > 1) { mx /= mag; my /= mag; }
    player.x = Math.max(21, Math.min(w - 21, player.x + mx * player.speed * dt));
    player.y = Math.max(21, Math.min(h - 21, player.y + my * player.speed * dt));
    player.angle = Math.atan2(pointer.y - player.y, pointer.x - player.x);
    player.invuln = Math.max(0, player.invuln - dt);
    if (roomChannel) { netSendClock += dt; if (netSendClock > .075) { netSendClock = 0; roomChannel.track(playerState()).catch(() => {}); sendRoomEvent('state', playerState()); } }
    spawnClock += dt;
    const spawnEvery = Math.max(.38, 1.45 - wave * .075);
    if (spawnClock > spawnEvery && enemies.length < 4 + wave * 2) { spawnClock = 0; spawnEnemy(); }
    const firing = pointer.down || keys.has(' ') || touchFire;
    shotClock -= dt;
    if (firing && shotClock <= 0) { shoot(); shotClock = .19; }
    for (const b of bullets) { b.x += b.vx*dt; b.y += b.vy*dt; b.life -= dt; }
    bullets = bullets.filter(b => b.life > 0 && b.x > -20 && b.x < w+20 && b.y > -20 && b.y < h+20);
    for (const e of enemies) {
      if (e.remote) continue;
      const dx = player.x-e.x, dy = player.y-e.y, d = Math.hypot(dx,dy) || 1;
      const speed = (e.type === 'runner' ? 107 : 60) + Math.min(45, wave*2);
      e.x += dx/d*speed*dt; e.y += dy/d*speed*dt; e.pulse += dt*4;
      if (d < e.r + 13 && player.invuln <= 0) damage();
      for (const b of bullets) if (b.life > 0 && Math.hypot(b.x-e.x,b.y-e.y) < e.r+4) { b.life=0; e.hp--; burst(b.x,b.y,'#d9f45b',3); if (e.hp<=0) { e.dead=true; kills++; burst(e.x,e.y,e.color,13); if (Math.random()<.065) pickups.push({x:e.x,y:e.y,life:8}); if(soundOn)tone(100,.06,'triangle',.02); } break; }
    }
    enemies = enemies.filter(e=>!e.dead);
    for (const p of pickups) { p.life-=dt; if(Math.hypot(player.x-p.x,player.y-p.y)<24){player.hp=Math.min(100,player.hp+18);p.life=0;burst(p.x,p.y,'#d9f45b',8);if(soundOn)tone(540,.12,'sine',.04);} }
    pickups=pickups.filter(p=>p.life>0);
    for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;p.vx*=.95;p.vy*=.95;}
    particles=particles.filter(p=>p.life>0);
    if (elapsed > 0 && elapsed % 22 < dt) { if(soundOn)tone(290,.1,'sine',.025); }
  }

  function spawnEnemy() {
    const side=Math.floor(Math.random()*4), pad=18;
    const x=side===0?-pad:side===1?W()+pad:rand(0,W());
    const y=side===2?-pad:side===3?H()+pad:rand(0,H());
    const runner=wave>=2&&Math.random()<Math.min(.4,.12+wave*.025);
    const enemy={x,y,r:runner?9:13,hp:runner?1:2,color:runner?'#ffb04e':'#ef654e',type:runner?'runner':'stalker',pulse:rand(0,6)};
    const id=`${localPlayerId}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    enemies.push({...enemy,id});
    if(roomChannel&&isRoomHost)sendRoomEvent('enemy',{kind:'spawn',id,enemy});
  }
  function shoot(){
    const a=player.angle+rand(-.025,.025), speed=610;
    bullets.push({x:player.x+Math.cos(a)*21,y:player.y+Math.sin(a)*21,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:.75});
    if(roomChannel)sendRoomEvent('shot',{id:localPlayerId,x:player.x+Math.cos(a)*21,y:player.y+Math.sin(a)*21,angle:a,color:playerState().color});
    if(soundOn && elapsed-lastShot>.1)tone(180,.035,'square',.016);
    lastShot=elapsed;
  }
  function damage(){player.hp-=17;player.invuln=.65;frame.classList.add('hit','shake');setTimeout(()=>frame.classList.remove('hit','shake'),170);burst(player.x,player.y,'#ff644e',8);if(soundOn)tone(75,.12,'sawtooth',.06);if(player.hp<=0)endGame();}
  function burst(x,y,color,n){for(let i=0;i<n;i++){const a=rand(0,Math.PI*2),s=rand(25,145);particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rand(.18,.48),max:.48,color});}}
  function tone(freq,duration,type,volume){try{audio??=new(window.AudioContext||window.webkitAudioContext)();const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.value=freq;g.gain.value=volume;g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+duration);}catch{}}

  function render(dt){
    drawBackground(dt);
    renderRemotePlayers();
    for(const s of remoteShots){ctx.save();ctx.strokeStyle=`${s.color||'#62d9ff'}aa`;ctx.lineWidth=3;ctx.shadowBlur=12;ctx.shadowColor=s.color||'#62d9ff';ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(s.x-Math.cos(s.angle)*17,s.y-Math.sin(s.angle)*17);ctx.stroke();ctx.restore();s.life-=dt;}
    remoteShots=remoteShots.filter(s=>s.life>0);
    for(const p of pickups){ctx.save();ctx.shadowBlur=17;ctx.shadowColor='#d9f45b';ctx.strokeStyle='#d9f45b';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,7+Math.sin(elapsed*6)*2,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(p.x-3,p.y);ctx.lineTo(p.x+3,p.y);ctx.moveTo(p.x,p.y-3);ctx.lineTo(p.x,p.y+3);ctx.stroke();ctx.restore();}
    for(const b of bullets){ctx.strokeStyle='#d9f45b';ctx.lineWidth=2;ctx.shadowBlur=9;ctx.shadowColor='#d9f45b';ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-b.vx*.025,b.y-b.vy*.025);ctx.stroke();ctx.shadowBlur=0;}
    for(const e of enemies){ctx.save();ctx.translate(e.x,e.y);ctx.shadowBlur=16;ctx.shadowColor=e.color;ctx.fillStyle='#100f0e';ctx.strokeStyle=e.color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,e.r+Math.sin(e.pulse)*1.3,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=e.color;ctx.beginPath();ctx.arc(3,-3,2,0,Math.PI*2);ctx.fill();ctx.restore();}
    for(const p of particles){ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,2.5,2.5);}ctx.globalAlpha=1;
    if(player){ctx.save();ctx.translate(player.x,player.y);ctx.rotate(player.angle);const blink=player.invuln>0&&Math.floor(elapsed*18)%2===0;ctx.globalAlpha=blink?.35:1;ctx.shadowBlur=18;ctx.shadowColor='#d9f45b';ctx.fillStyle='#d9f45b';ctx.fillRect(2,-4,25,8);ctx.fillStyle='#a6c832';ctx.fillRect(18,-2,17,4);ctx.restore();ctx.save();ctx.globalAlpha=player.invuln>0?.45:1;ctx.shadowBlur=19;ctx.shadowColor='#d9f45b';ctx.fillStyle='#d9f45b';ctx.beginPath();ctx.arc(player.x,player.y,11,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#243016';ctx.beginPath();ctx.arc(player.x,player.y,4,0,Math.PI*2);ctx.fill();ctx.restore();}
    if(running&&pointer.x){ctx.strokeStyle='#d9f45b66';ctx.lineWidth=1;ctx.beginPath();ctx.arc(pointer.x,pointer.y,7,0,Math.PI*2);ctx.moveTo(pointer.x-11,pointer.y);ctx.lineTo(pointer.x-5,pointer.y);ctx.moveTo(pointer.x+5,pointer.y);ctx.lineTo(pointer.x+11,pointer.y);ctx.moveTo(pointer.x,pointer.y-11);ctx.lineTo(pointer.x,pointer.y-5);ctx.moveTo(pointer.x,pointer.y+5);ctx.lineTo(pointer.x,pointer.y+11);ctx.stroke();}
  }
  function renderRemotePlayers(){
    if(!ctx)return;
    for(const p of roomPlayers.values()){
      if(typeof p.x!=='number'||typeof p.y!=='number')continue;
      const color=p.color||'#62d9ff';ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle||0);ctx.shadowBlur=17;ctx.shadowColor=color;ctx.fillStyle=color;ctx.fillRect(1,-3,25,6);ctx.restore();ctx.save();ctx.shadowBlur=19;ctx.shadowColor=color;ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,10,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#080d0b';ctx.font='10px Arial';ctx.textAlign='center';ctx.fillText(p.name||'隊友',p.x,p.y-18);ctx.restore();
    }
  }
  function updateHud(){document.getElementById('waveVal').textContent=String(wave).padStart(2,'0');document.getElementById('killVal').textContent=String(kills).padStart(3,'0');const t=Math.floor(elapsed);document.getElementById('timeVal').textContent=`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;if(player){document.getElementById('healthFill').style.width=`${Math.max(0,player.hp)}%`;document.getElementById('healthVal').textContent=Math.max(0,Math.ceil(player.hp));document.getElementById('waveCaption').textContent=`WAVE ${String(wave).padStart(2,'0')} — HOLD THE LINE`;}}
  function endGame(){running=false;cancelAnimationFrame(animationId);hud.classList.add('hidden');document.getElementById('statusText').textContent='SIGNAL LOST';const best=Math.max(kills,Number(localStorage.getItem(BEST_KEY)||0));localStorage.setItem(BEST_KEY,best);bestScore.textContent=String(best).padStart(3,'0');overlay.classList.remove('hidden');overlayContent.innerHTML=`<div class="overline"><span class="live-dot"></span> SIGNAL LOST · RUN COMPLETE</div><div class="overlay-icon" style="color:var(--orange)">✳</div><h2>燈，熄了。</h2><p class="overlay-copy">你撐過了 ${formatTime(elapsed)}，擊倒 <strong style="color:var(--lime)">${kills}</strong> 個影子。<br>街區還記得你的名字。</p><button class="start-button" id="restartBtn"><span>再試一次</span><span class="button-arrow">↗</span></button><div class="press-hint">按 <kbd>ENTER</kbd> 再來一局</div>`;document.getElementById('restartBtn').addEventListener('click',start);}
  function formatTime(s){const t=Math.floor(s);return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;}
  function setPointer(e){const r=canvas.getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;}
  canvas.addEventListener('pointermove',setPointer);canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'){setPointer(e);pointer.down=true;}});window.addEventListener('pointerup',e=>{if(e.pointerType==='mouse')pointer.down=false;});
  window.addEventListener('keydown',e=>{const key=e.key.toLowerCase();if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key))e.preventDefault();keys.add(key);if(key==='enter'&&!running)start();if(key==='escape'&&running)pointer.down=false;});window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
  startBtn.addEventListener('click',start);
  document.getElementById('soundToggle').addEventListener('click',()=>{soundOn=!soundOn;document.getElementById('soundIcon').textContent=soundOn?'♫':'♪';document.querySelector('.sound-label').textContent=soundOn?'SOUND ON':'SOUND OFF';if(soundOn)tone(440,.08,'sine',.03);});
  const pad=document.getElementById('movePad'),knob=document.getElementById('moveKnob');let padId=null,padCenter=null;
  pad.addEventListener('pointerdown',e=>{e.preventDefault();padId=e.pointerId;pad.setPointerCapture(padId);const r=pad.getBoundingClientRect();padCenter={x:r.left+r.width/2,y:r.top+r.height/2};movePad(e);});
  pad.addEventListener('pointermove',e=>{if(e.pointerId===padId)movePad(e);});
  function movePad(e){const dx=e.clientX-padCenter.x,dy=e.clientY-padCenter.y,len=Math.hypot(dx,dy),max=35,scale=len>max?max/len:1;touchMove={x:dx*scale/max,y:dy*scale/max};knob.style.transform=`translate(${dx*scale}px,${dy*scale}px)`;}
  function resetPad(e){if(e.pointerId===padId){padId=null;touchMove={x:0,y:0};knob.style.transform='';}}
  pad.addEventListener('pointerup',resetPad);pad.addEventListener('pointercancel',resetPad);
  const fire=document.getElementById('fireBtn');fire.addEventListener('pointerdown',e=>{e.preventDefault();touchFire=true;fire.setPointerCapture(e.pointerId);const r=canvas.getBoundingClientRect();pointer.x=r.width*.72;pointer.y=r.height*.45;});fire.addEventListener('pointerup',()=>touchFire=false);fire.addEventListener('pointercancel',()=>touchFire=false);
  window.addEventListener('resize',size);size();initScene();
})();
