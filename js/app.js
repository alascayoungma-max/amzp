// ===== APP PRINCIPAL =====
// Aguarda o Firebase carregar
function aguardaFirebase(){
  return new Promise(r=>{
    const check=()=>window.firebaseDB ? r() : setTimeout(check,50);
    check();
  });
}

await aguardaFirebase();
const { db, collection, doc, setDoc, onSnapshot, addDoc, query, orderBy, getDocs, runTransaction, deleteDoc } = window.firebaseDB;

// ===== DADOS INICIAIS =====
const PEDIDOS_BASE=[
  {id:'657',produto:'Cx de passagem',cliente:'FTE',qtdPedida:60,unid:'un',dataPedido:'2026-05-11',prazoEntrega:'2026-05-21',qtdProduzida:0},
  {id:'663a',produto:'Poste dt 11/300',cliente:'Anavilhanas',qtdPedida:38,unid:'un',dataPedido:'2026-05-14',prazoEntrega:'2026-05-19',qtdProduzida:20},
  {id:'663b',produto:'Poste dt 11/1000',cliente:'Anavilhanas',qtdPedida:1,unid:'un',dataPedido:'2026-05-14',prazoEntrega:'2026-05-19',qtdProduzida:0},
  {id:'654',produto:'Mourão',cliente:'Claudio',qtdPedida:300,unid:'un',dataPedido:'2026-05-07',prazoEntrega:'2026-05-21',qtdProduzida:125},
  {id:'426130',produto:'Poste dt 13/600',cliente:'Etam',qtdPedida:4,unid:'un',dataPedido:'2026-05-13',prazoEntrega:'2026-05-18',qtdProduzida:0},
  {id:'611',produto:'Placa',cliente:'Avanço',qtdPedida:240,unid:'un',dataPedido:'2026-05-05',prazoEntrega:'2026-05-05',qtdProduzida:157},
  {id:'650',produto:'Meio fio',cliente:'Ardo',qtdPedida:1900,unid:'un',dataPedido:'2026-05-05',prazoEntrega:'2026-05-29',qtdProduzida:490},
  {id:'646',produto:'Barreira',cliente:'Hibrapel',qtdPedida:5,unid:'un',dataPedido:'2026-04-28',prazoEntrega:'2026-05-29',qtdProduzida:0},
  {id:'18014',produto:'Paver 8 cm vermelho',cliente:'Orbity',qtdPedida:30,unid:'m',dataPedido:'2026-05-13',prazoEntrega:'2026-05-25',qtdProduzida:30},
];

let pedidos=[], apontamentos=[], entregas=[], curFilter='todos', curPeriodo='hoje', editingId=null, qty=0, turno='Manhã';
let entregaPedidoId=null, entregaStatus='Entregue', entregaFotoBase64='', entregaSigConf='', entregaSigCli='';
let salvandoEntrega = false;
let produtosLinhas = [];
let produtoLinhaSeq = 0;
const ORDEM_STATUS={'Atrasado':0,'Em risco':1,'No prazo':2,'Concluído':3};

// ===== HELPERS =====
function hoje(){return new Date().toISOString().slice(0,10)}
function fmtDate(d){if(!d)return'—';const p=d.split('-');return p[2]+'/'+p[1]+'/'+p[0]}
function pct(a,b){return b>0?Math.min(100,Math.round((a/b)*100)):0}

function calcStatus(p){
  if(p.qtdProduzida>=p.qtdPedida) return 'Concluído';
  const prazo=new Date(p.prazoEntrega),now=new Date();
  now.setHours(0,0,0,0);prazo.setHours(0,0,0,0);
  const diff=Math.round((prazo-now)/86400000);
  if(diff<0) return 'Atrasado';
  if(diff<=2) return 'Em risco';
  return 'No prazo';
}
function statusBadge(s){
  if(s==='Concluído') return '<span class="bdg g">✅ Concluído</span>';
  if(s==='Atrasado')  return '<span class="bdg r">🔴 Atrasado</span>';
  if(s==='Em risco')  return '<span class="bdg a">🟡 Em risco</span>';
  return '<span class="bdg b">🟢 No prazo</span>';
}
function diasRestantes(prazo){
  const p=new Date(prazo),n=new Date();n.setHours(0,0,0,0);p.setHours(0,0,0,0);
  return Math.round((p-n)/86400000);
}
function qtdEntregue(pedidoId){
  return entregas.filter(e=>e.pedidoId===pedidoId && e.status!=='Devolvido').reduce((s,e)=>s+(e.qtd||0),0);
}
function letraSequencia(n){
  let s = ''; n = n + 1;
  while(n > 0){ n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}
function showToast(msg){
  document.getElementById('t-el')?.remove();
  const t=document.createElement('div');t.id='t-el';t.className='toast';t.textContent=msg;
  document.body.appendChild(t);setTimeout(()=>t.remove(),2400);
}

// ===== SYNC FIREBASE =====
function iniciarSync(){
  document.getElementById('sync-status').textContent='☁️ conectando...';
  onSnapshot(collection(db,'pedidos'), snap=>{
    if(snap.empty){
      PEDIDOS_BASE.forEach(p=>setDoc(doc(db,'pedidos',p.id),p));
    } else {
      pedidos = snap.docs.map(d=>d.data());
      rPedidos();
      updateTopbar();
      document.getElementById('sync-status').textContent='☁️ online';
    }
  });
  const qAp = query(collection(db,'apontamentos'), orderBy('timestamp','desc'));
  onSnapshot(qAp, snap=>{
    apontamentos = snap.docs.map(d=>({...d.data(), docId:d.id}));
    if(document.getElementById('scr-ap').classList.contains('on')) rApontamentos();
    if(document.getElementById('scr-dash').classList.contains('on')) rDash();
  });
  const qEnt = query(collection(db,'entregas'), orderBy('timestamp','desc'));
  onSnapshot(qEnt, snap=>{
    entregas = snap.docs.map(d=>({...d.data(), docId:d.id}));
    if(document.getElementById('scr-entrega').classList.contains('on')) rEntregas();
    if(document.getElementById('scr-dash').classList.contains('on')) rDash();
    rPedidos();
  });
}

async function savePedido(p){ await setDoc(doc(db,'pedidos',p.id), p); }
async function saveApontamento(ap){ await addDoc(collection(db,'apontamentos'), ap); }
async function saveEntrega(ent){ await addDoc(collection(db,'entregas'), ent); }

async function gerarRomaneio(){
  const counterRef = doc(db,'contadores','romaneio');
  try {
    const novo = await runTransaction(db, async (tx)=>{
      const s = await tx.get(counterRef);
      const next = (s.exists() ? s.data().valor : 0) + 1;
      tx.set(counterRef, {valor:next});
      return next;
    });
    return '#'+String(novo).padStart(4,'0');
  } catch(e) {
    return '#'+String(Math.floor(Math.random()*9999)).padStart(4,'0');
  }
}
async function previewProximoRomaneio(){
  try {
    const snap = await getDocs(collection(db,'contadores'));
    const c = snap.docs.find(d=>d.id==='romaneio');
    const atual = c ? c.data().valor : 0;
    return '#'+String(atual+1).padStart(4,'0');
  } catch { return '#0001'; }
}

// ===== NAVEGAÇÃO =====
window.showScr=function(name,btn){
  document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));
  document.getElementById('scr-'+name).classList.add('on');
  document.querySelectorAll('.nb').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  if(name==='dash') rDash();
  if(name==='ap') rApontamentos();
  if(name==='entrega') rEntregas();
  if(name==='export') rExport();
};
window.setF=function(f,el){curFilter=f;document.querySelectorAll('#scr-pedidos .fc').forEach(c=>c.classList.remove('on'));el.classList.add('on');rPedidos();};
window.setPeriodo=function(p,el){curPeriodo=p;document.querySelectorAll('#scr-dash .fc').forEach(c=>c.classList.remove('on'));el.classList.add('on');rDash();};
window.setTurno=function(t,el){turno=t;document.querySelectorAll('.tpill').forEach(p=>p.classList.remove('on'));el.classList.add('on');};

// ===== PEDIDOS =====
function rPedidos(){
  const q=(document.getElementById('srch').value||'').toLowerCase();
  const list=pedidos.filter(p=>{
    const s=calcStatus(p);
    return(curFilter==='todos'||s===curFilter)&&(!q||p.id.toLowerCase().includes(q)||p.cliente.toLowerCase().includes(q)||p.produto.toLowerCase().includes(q));
  }).sort((a,b)=>(ORDEM_STATUS[calcStatus(a)]??9)-(ORDEM_STATUS[calcStatus(b)]??9));

  document.getElementById('p-count').textContent=list.length+' pedidos';
  const el=document.getElementById('p-list');
  if(!list.length){el.innerHTML='<div class="empty">📭 Nenhum pedido encontrado</div>';return;}
  el.innerHTML=list.map(p=>{
    const s=calcStatus(p),pr=pct(p.qtdProduzida,p.qtdPedida),dias=diasRestantes(p.prazoEntrega),saldo=p.qtdPedida-p.qtdProduzida;
    const ent=qtdEntregue(p.id);
    const barCol=s==='Concluído'?'var(--green)':s==='Atrasado'?'var(--red)':s==='Em risco'?'var(--amber)':'var(--blue)';
    const diasStr=dias<0?`<span style="color:var(--redtxt);font-size:11px">${Math.abs(dias)}d atraso</span>`:dias===0?`<span style="color:var(--ambertxt);font-size:11px">Vence hoje</span>`:`<span style="color:var(--text3);font-size:11px">${dias}d restantes</span>`;
    return`<div class="card" onclick="openModal('${p.id}')">
      <div class="ch"><div><div class="cid">OP #${p.id}</div><div class="ccli">${p.cliente}</div><div class="cprod">${p.produto}</div></div>${statusBadge(s)}</div>
      <div style="display:flex;align-items:center;gap:6px;margin:6px 0"><div class="pbar"><div class="pfill" style="width:${pr}%;background:${barCol}"></div></div><span style="font-size:11px;color:var(--text3);font-family:var(--mono);flex-shrink:0">${pr}%</span></div>
      <div class="cf"><div style="display:flex;gap:10px;font-size:11px;color:var(--text2);flex-wrap:wrap"><span>📦 <b style="color:var(--text)">${p.qtdPedida}</b></span><span>⚙️ <b style="color:var(--green)">${p.qtdProduzida}</b></span><span>🚚 <b style="color:var(--bluetxt)">${ent}</b></span></div>${diasStr}</div>
    </div>`;
  }).join('');
}
window.rPedidos=rPedidos;

// ===== MODAL APONTAMENTO =====
window.openModal=function(id){
  const p=pedidos.find(x=>x.id===id);if(!p)return;
  editingId=id;qty=0;
  document.getElementById('m-title').textContent='OP #'+p.id+' — '+p.cliente;
  document.getElementById('m-sub').textContent=p.produto;
  const s=calcStatus(p),saldo=p.qtdPedida-p.qtdProduzida;
  document.getElementById('m-info').innerHTML=`
    <div class="irow" style="padding-top:0"><span class="ilbl">Status</span>${statusBadge(s)}</div>
    <div class="irow"><span class="ilbl">Pedido total</span><span class="ival">${p.qtdPedida} ${p.unid}</span></div>
    <div class="irow"><span class="ilbl">Já produzido</span><span class="ival" style="color:var(--green)">${p.qtdProduzida} ${p.unid}</span></div>
    <div class="irow"><span class="ilbl">Saldo a produzir</span><span class="ival" style="color:var(--ambertxt)">${saldo} ${p.unid}</span></div>
    <div class="irow" style="padding-bottom:0"><span class="ilbl">Prazo</span><span class="ival">${fmtDate(p.prazoEntrega)}</span></div>`;
  document.getElementById('qty-input').value='0';
  document.getElementById('qty-hint').textContent='Saldo: '+saldo+' '+p.unid;
  document.getElementById('f-data').value=hoje();
  document.getElementById('f-op').value='';document.getElementById('f-obs').value='';
  turno='Manhã';document.querySelectorAll('#modal .tpill').forEach((b,i)=>b.classList[i===0?'add':'remove']('on'));
  document.getElementById('modal').classList.add('on');
  document.getElementById('mdl-body').scrollTop=0;
};

window.chQty=function(d){
  const p=pedidos.find(x=>x.id===editingId);if(!p)return;
  const max=p.qtdPedida-p.qtdProduzida;
  const cur=parseInt(document.getElementById('qty-input').value)||0;
  document.getElementById('qty-input').value=Math.max(0,Math.min(max,cur+d));
  qty=parseInt(document.getElementById('qty-input').value);
};
window.qtyInputChange=function(){
  const p=pedidos.find(x=>x.id===editingId);if(!p)return;
  const max=p.qtdPedida-p.qtdProduzida;
  let v=parseInt(document.getElementById('qty-input').value)||0;
  v=Math.max(0,Math.min(max,v));
  document.getElementById('qty-input').value=v;
  qty=v;
};
window.closeModal=function(){document.getElementById('modal').classList.remove('on');};
window.ovClick=function(e){if(e.target===document.getElementById('modal'))window.closeModal();};

window.salvar=async function(){
  const p=pedidos.find(x=>x.id===editingId);
  qty=parseInt(document.getElementById('qty-input').value)||0;
  if(!p||qty<=0){showToast('⚠️ Informe a quantidade');return;}
  const op=document.getElementById('f-op').value.trim()||'Operador';
  const data=document.getElementById('f-data').value||hoje();
  const obs=document.getElementById('f-obs').value.trim();
  p.qtdProduzida=Math.min(p.qtdPedida,p.qtdProduzida+qty);
  const ap={pedidoId:p.id,cliente:p.cliente,produto:p.produto,unid:p.unid,qtd:qty,turno,operador:op,data,obs,timestamp:new Date().toISOString(),statusDepois:calcStatus(p)};
  await savePedido(p);
  await saveApontamento(ap);
  window.closeModal();
  showToast('✓ Apontamento salvo!');
};

// ===== NOVO PEDIDO (multi-produto) =====
function renderProdutosLista(){
  const el = document.getElementById('produtos-lista');
  el.innerHTML = produtosLinhas.map((p, idx)=>`
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:11px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:11px;font-weight:600;color:var(--bluetxt);font-family:var(--mono)">Produto ${idx+1}</span>
        ${produtosLinhas.length>1?`<span onclick="removerProdutoLinha('${p.uid}')" style="font-size:14px;color:var(--redtxt);cursor:pointer;padding:2px 6px;touch-action:manipulation" title="Remover">🗑️</span>`:''}
      </div>
      <div style="margin-bottom:8px">
        <label style="display:block;font-size:10px;font-weight:600;letter-spacing:.06em;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Produto</label>
        <input type="text" placeholder="Ex: Poste dt 11/300" value="${p.produto||''}" oninput="atualizarProdutoLinha('${p.uid}','produto',this.value)" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);color:var(--text);font-family:var(--font);font-size:13px;padding:8px 10px;outline:none">
      </div>
      <div style="display:flex;gap:8px">
        <div style="flex:1.3">
          <label style="display:block;font-size:10px;font-weight:600;letter-spacing:.06em;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Quantidade</label>
          <input type="number" placeholder="0" min="1" value="${p.qtd||''}" oninput="atualizarProdutoLinha('${p.uid}','qtd',this.value)" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);color:var(--text);font-family:var(--mono);font-size:14px;font-weight:600;padding:8px 10px;outline:none;text-align:center">
        </div>
        <div style="flex:1">
          <label style="display:block;font-size:10px;font-weight:600;letter-spacing:.06em;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Unidade</label>
          <select onchange="atualizarProdutoLinha('${p.uid}','unid',this.value)" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);color:var(--text);font-family:var(--font);font-size:13px;padding:8px 10px;outline:none">
            <option value="un" ${p.unid==='un'?'selected':''}>un</option>
            <option value="m" ${p.unid==='m'?'selected':''}>m</option>
            <option value="m²" ${p.unid==='m²'?'selected':''}>m²</option>
            <option value="m³" ${p.unid==='m³'?'selected':''}>m³</option>
            <option value="palete" ${p.unid==='palete'?'selected':''}>palete</option>
          </select>
        </div>
      </div>
    </div>`).join('');
  document.getElementById('produtos-total').textContent = produtosLinhas.length + ' produto(s)';
}
window.addProdutoLinha=function(){
  produtosLinhas.push({uid:'L'+(++produtoLinhaSeq), produto:'', qtd:'', unid:'un'});
  renderProdutosLista();
};
window.removerProdutoLinha=function(uid){
  if(produtosLinhas.length<=1)return;
  produtosLinhas = produtosLinhas.filter(p=>p.uid!==uid);
  renderProdutosLista();
};
window.atualizarProdutoLinha=function(uid, campo, valor){
  const p = produtosLinhas.find(x=>x.uid===uid);
  if(p) p[campo] = valor;
};
window.openNovoPedido=function(){
  document.getElementById('n-id').value='';
  document.getElementById('n-cliente').value='';
  document.getElementById('n-datapd').value=hoje();
  document.getElementById('n-prazo').value='';
  produtosLinhas = []; produtoLinhaSeq = 0;
  window.addProdutoLinha();
  document.getElementById('modal-novo').classList.add('on');
  document.getElementById('mdl-novo').scrollTop=0;
};
window.closeNovoPedido=function(){document.getElementById('modal-novo').classList.remove('on');};
window.ovClickNovo=function(e){if(e.target===document.getElementById('modal-novo'))window.closeNovoPedido();};

window.salvarNovoPedido=async function(){
  const idBase=document.getElementById('n-id').value.trim();
  const cliente=document.getElementById('n-cliente').value.trim();
  const dataPedido=document.getElementById('n-datapd').value||hoje();
  const prazoEntrega=document.getElementById('n-prazo').value;
  if(!idBase||!cliente||!prazoEntrega){showToast('⚠️ Preencha os dados do pedido!');return;}
  const validos = produtosLinhas.filter(p => p.produto.trim() && parseInt(p.qtd)>0);
  if(!validos.length){showToast('⚠️ Adicione ao menos um produto!');return;}
  for(const p of produtosLinhas){
    if(!p.produto.trim() || parseInt(p.qtd)<=0){
      showToast('⚠️ Preencha produto e quantidade em todos os itens!');return;
    }
  }
  const usarSufixo = validos.length > 1;
  for(let i=0; i<validos.length; i++){
    const id = usarSufixo ? idBase + letraSequencia(i) : idBase;
    if(pedidos.find(p=>p.id===id)){
      showToast('⚠️ Já existe pedido com o número #'+id+'!');return;
    }
  }
  try {
    for(let i=0; i<validos.length; i++){
      const p = validos[i];
      const id = usarSufixo ? idBase + letraSequencia(i) : idBase;
      await savePedido({
        id, produto:p.produto.trim(), cliente,
        qtdPedida:parseInt(p.qtd), unid:p.unid||'un',
        dataPedido, prazoEntrega, qtdProduzida:0
      });
    }
    window.closeNovoPedido();
    showToast(validos.length>1 ? '✅ Pedido #'+idBase+' cadastrado com '+validos.length+' itens!' : '✅ Pedido #'+idBase+' cadastrado!');
  } catch(err) {
    showToast('⚠️ Erro: '+err.message);
  }
};

// ===== ENTREGA =====
window.openNovaEntrega=async function(){
  entregaPedidoId=null; entregaStatus='Entregue';
  entregaFotoBase64=''; entregaSigConf=''; entregaSigCli='';
  document.getElementById('e-busca').value='';
  document.getElementById('e-busca-result').style.display='none';
  document.getElementById('e-pedido-card').style.display='none';
  document.getElementById('e-qty').value='0';
  document.getElementById('e-unid').value='un';
  document.getElementById('e-saldo').style.display='none';
  document.getElementById('e-entregador').value='';
  document.getElementById('e-conferente').value='';
  document.getElementById('e-veiculo').value='';
  document.getElementById('e-destino').value='';
  document.getElementById('e-obs').value='';
  document.getElementById('e-foto-preview').style.display='none';
  window.setStatusEntrega('Entregue');
  const n=new Date();
  document.getElementById('e-data').textContent=n.toLocaleDateString('pt-BR');
  document.getElementById('e-rom').textContent = await previewProximoRomaneio();
  document.getElementById('modal-entrega').classList.add('on');
  document.getElementById('mdl-entrega').scrollTop=0;
  setTimeout(()=>{initSig('conf');initSig('cli');},150);
};
window.closeEntrega=function(){document.getElementById('modal-entrega').classList.remove('on');};
window.ovClickEntrega=function(e){if(e.target===document.getElementById('modal-entrega'))window.closeEntrega();};

window.buscarPedidoEntrega=function(){
  const q=(document.getElementById('e-busca').value||'').toLowerCase();
  const r=document.getElementById('e-busca-result');
  if(!q){r.style.display='none';return;}
  const matches=pedidos.filter(p=>p.id.toLowerCase().includes(q)||p.cliente.toLowerCase().includes(q)||p.produto.toLowerCase().includes(q)).slice(0,6);
  if(!matches.length){r.innerHTML='<div style="padding:9px 11px;font-size:12px;color:var(--text3)">Nenhum pedido encontrado</div>';r.style.display='block';return;}
  r.innerHTML=matches.map(p=>`<div onclick="selecionarPedidoEntrega('${p.id}')" style="padding:9px 11px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px"><b style="color:var(--bluetxt);font-family:var(--mono)">#${p.id}</b> · ${p.cliente} <span style="color:var(--text3)">— ${p.produto}</span></div>`).join('');
  r.style.display='block';
};
window.selecionarPedidoEntrega=function(id){
  const p=pedidos.find(x=>x.id===id);if(!p)return;
  entregaPedidoId=id;
  const ent=qtdEntregue(id);
  const s=calcStatus(p);
  document.getElementById('e-busca').value=`#${p.id} · ${p.cliente}`;
  document.getElementById('e-busca-result').style.display='none';
  document.getElementById('e-unid').value=p.unid||'un';
  const card=document.getElementById('e-pedido-card');
  card.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
      <div>
        <div style="font-size:10px;color:var(--bluetxt);font-family:var(--mono)">OP #${p.id}</div>
        <div style="font-size:13px;font-weight:600;color:var(--text)">${p.cliente}</div>
        <div style="font-size:11px;color:var(--text2)">${p.produto}</div>
      </div>${statusBadge(s)}
    </div>
    <div style="display:flex;gap:14px;font-size:11px;color:var(--text2);padding-top:8px;border-top:1px solid var(--border)">
      <span>📦 <b style="color:var(--text)">${p.qtdPedida}</b></span>
      <span>⚙️ <b style="color:var(--greentxt)">${p.qtdProduzida}</b></span>
      <span>🚚 <b style="color:var(--bluetxt)">${ent}</b></span>
    </div>`;
  card.style.display='block';
  window.updateSaldoEntrega();
};
window.chQtyE=function(d){
  if(!entregaPedidoId)return;
  const p=pedidos.find(x=>x.id===entregaPedidoId);if(!p)return;
  const ent=qtdEntregue(entregaPedidoId);
  const max=p.qtdProduzida-ent;
  const cur=parseInt(document.getElementById('e-qty').value)||0;
  document.getElementById('e-qty').value=Math.max(0,Math.min(max,cur+d));
  window.updateSaldoEntrega();
};
window.updateSaldoEntrega=function(){
  if(!entregaPedidoId){document.getElementById('e-saldo').style.display='none';return;}
  const p=pedidos.find(x=>x.id===entregaPedidoId);if(!p)return;
  const ent=qtdEntregue(entregaPedidoId);
  const novo=parseInt(document.getElementById('e-qty').value)||0;
  const max=p.qtdProduzida-ent;
  if(novo>max){document.getElementById('e-qty').value=max;}
  const restante=p.qtdProduzida-ent-(parseInt(document.getElementById('e-qty').value)||0);
  const unid=document.getElementById('e-unid').value;
  const el=document.getElementById('e-saldo');
  el.style.display='flex';
  el.innerHTML=`<span style="font-size:11px;color:var(--green)">Saldo após essa entrega</span><span style="font-size:12px;font-weight:700;color:var(--greentxt)">${restante} ${unid} restantes</span>`;
};
window.setStatusEntrega=function(s){
  entregaStatus=s;
  document.getElementById('st-entregue').className='st-pill'+(s==='Entregue'?' on-g':'');
  document.getElementById('st-parcial').className='st-pill'+(s==='Parcial'?' on-a':'');
  document.getElementById('st-devolvido').className='st-pill'+(s==='Devolvido'?' on-r':'');
};
window.processFoto=function(e){
  const f=e.target.files[0];if(!f)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    entregaFotoBase64=ev.target.result;
    const prev=document.getElementById('e-foto-preview');
    prev.style.display='flex';
    prev.innerHTML=`<div class="photo-thumb"><img src="${entregaFotoBase64}"></div><div style="flex:1"><div style="font-size:11px;color:var(--greentxt);font-weight:600">Foto anexada</div><div style="font-size:10px;color:var(--text3)">${new Date().toLocaleString('pt-BR')}</div></div><span style="font-size:16px;color:var(--redtxt);cursor:pointer" onclick="removerFoto()">✕</span>`;
  };
  reader.readAsDataURL(f);
};
window.removerFoto=function(){entregaFotoBase64='';document.getElementById('e-foto-preview').style.display='none';document.getElementById('e-foto-input').value='';};

// ===== ASSINATURA CANVAS =====
const sigState = {conf:{drawing:false,empty:true,ctx:null,canvas:null},cli:{drawing:false,empty:true,ctx:null,canvas:null}};
function initSig(tipo){
  const canvas=document.getElementById('sig-canvas-'+tipo);
  const pad=document.getElementById('sig-pad-'+tipo);
  const rect=pad.getBoundingClientRect();
  canvas.width=rect.width; canvas.height=rect.height;
  const ctx=canvas.getContext('2d');
  ctx.strokeStyle='#c9d1d9'; ctx.lineWidth=2; ctx.lineCap='round'; ctx.lineJoin='round';
  sigState[tipo].ctx=ctx; sigState[tipo].canvas=canvas; sigState[tipo].empty=true;
  const start=(x,y)=>{sigState[tipo].drawing=true;sigState[tipo].empty=false;document.getElementById('sig-hint-'+tipo).classList.add('hidden');ctx.beginPath();ctx.moveTo(x,y);};
  const move=(x,y)=>{if(!sigState[tipo].drawing)return;ctx.lineTo(x,y);ctx.stroke();};
  const end=()=>{sigState[tipo].drawing=false;};
  const pos=e=>{const r=canvas.getBoundingClientRect();const t=e.touches?e.touches[0]:e;return [t.clientX-r.left,t.clientY-r.top];};
  canvas.ontouchstart=e=>{e.preventDefault();const [x,y]=pos(e);start(x,y);};
  canvas.ontouchmove=e=>{e.preventDefault();const [x,y]=pos(e);move(x,y);};
  canvas.ontouchend=e=>{e.preventDefault();end();};
  canvas.onmousedown=e=>{const [x,y]=pos(e);start(x,y);};
  canvas.onmousemove=e=>{const [x,y]=pos(e);move(x,y);};
  canvas.onmouseup=end; canvas.onmouseleave=end;
}
window.clearSig=function(tipo){
  const s=sigState[tipo];if(!s.ctx)return;
  s.ctx.clearRect(0,0,s.canvas.width,s.canvas.height);
  s.empty=true;
  document.getElementById('sig-hint-'+tipo).classList.remove('hidden');
  document.getElementById('sig-pad-'+tipo).classList.remove('signed');
  if(tipo==='conf') entregaSigConf=''; else entregaSigCli='';
};
window.confirmSig=function(tipo){
  const s=sigState[tipo];if(!s.ctx||s.empty){showToast('⚠️ Assine primeiro');return;}
  const data=s.canvas.toDataURL('image/png');
  if(tipo==='conf') entregaSigConf=data; else entregaSigCli=data;
  document.getElementById('sig-pad-'+tipo).classList.add('signed');
  showToast('✓ Assinatura confirmada');
};

window.salvarEntrega=async function(){
  if(salvandoEntrega){return;}
  if(!entregaPedidoId){showToast('⚠️ Selecione um pedido');return;}
  const qtd=parseInt(document.getElementById('e-qty').value)||0;
  if(qtd<=0){showToast('⚠️ Informe a quantidade');return;}
  const conferente=document.getElementById('e-conferente').value.trim();
  if(!conferente){showToast('⚠️ Informe o conferente');return;}
  if(!entregaSigConf){showToast('⚠️ Assinatura do conferente necessária');return;}
  salvandoEntrega = true;
  const btnSalvar = document.querySelector('#mdl-entrega .btn-g');
  const btnTextoOriginal = btnSalvar.textContent;
  btnSalvar.textContent = '⏳ Salvando...';
  btnSalvar.style.opacity = '0.6';
  btnSalvar.disabled = true;
  try {
    const p=pedidos.find(x=>x.id===entregaPedidoId);
    const romaneio = await gerarRomaneio();
    const ent={
      romaneio, pedidoId:entregaPedidoId, cliente:p.cliente, produto:p.produto, qtd,
      unid:document.getElementById('e-unid').value,
      entregador:document.getElementById('e-entregador').value.trim(),
      conferente,
      veiculo:document.getElementById('e-veiculo').value.trim(),
      destino:document.getElementById('e-destino').value.trim(),
      status:entregaStatus, obs:document.getElementById('e-obs').value.trim(),
      foto:entregaFotoBase64, sigConf:entregaSigConf, sigCli:entregaSigCli,
      data:hoje(), timestamp:new Date().toISOString()
    };
    await saveEntrega(ent);
    window.closeEntrega();
    showToast('✅ Entrega '+romaneio+' registrada!');
  } catch(err) {
    showToast('⚠️ Erro ao salvar: '+err.message);
  } finally {
    salvandoEntrega = false;
    btnSalvar.textContent = btnTextoOriginal;
    btnSalvar.style.opacity = '1';
    btnSalvar.disabled = false;
  }
};
window.excluirEntrega=async function(docId, romaneio){
  if(!confirm('Excluir a entrega '+romaneio+'?\n\nEsta ação não pode ser desfeita.'))return;
  try { await deleteDoc(doc(db,'entregas',docId)); showToast('🗑️ Entrega '+romaneio+' excluída'); }
  catch(err) { showToast('⚠️ Erro ao excluir'); }
};

// ===== LISTAGENS =====
function rEntregas(){
  const el=document.getElementById('entregas-list');
  if(!entregas.length){el.innerHTML='<div class="empty">🚚 Nenhuma entrega registrada ainda</div>';return;}
  el.innerHTML=entregas.slice(0,30).map(e=>{
    const dt=new Date(e.timestamp);
    const stBdg = e.status==='Entregue'?'<span style="font-size:9px;background:var(--greenbg);color:var(--greentxt);padding:2px 5px;border-radius:4px">✅ Entregue</span>':e.status==='Parcial'?'<span style="font-size:9px;background:var(--amberbg);color:var(--ambertxt);padding:2px 5px;border-radius:4px">⚠️ Parcial</span>':'<span style="font-size:9px;background:var(--redbg);color:var(--redtxt);padding:2px 5px;border-radius:4px">↩️ Devolvido</span>';
    const sigBdg = e.sigCli?'<span style="font-size:9px;background:var(--greenbg);color:var(--greentxt);padding:2px 5px;border-radius:4px">✍️ assinado</span>':'<span style="font-size:9px;background:var(--redbg);color:var(--redtxt);padding:2px 5px;border-radius:4px">✍️ pendente</span>';
    return `<div class="delivery-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
        <div><span class="cid">OP #${e.pedidoId}</span><span style="font-size:11px;color:var(--text2);margin-left:6px">${e.cliente}</span></div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="apt">${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>
          <span onclick="excluirEntrega('${e.docId}','${e.romaneio}')" style="font-size:14px;color:var(--redtxt);cursor:pointer;padding:2px 4px;touch-action:manipulation" title="Excluir">🗑️</span>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:6px">${e.produto} · Rom. <b style="color:var(--bluetxt)">${e.romaneio}</b></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="font-size:11px;color:var(--text2);flex:1;min-width:0">🚚 ${e.entregador||'—'} · 🔍 ${e.conferente||'—'} · 🚗 ${e.veiculo||'—'}</div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:13px;font-weight:700;color:var(--greentxt)">${e.qtd} ${e.unid}</div>
          <div style="display:flex;gap:3px;margin-top:2px">${stBdg}${sigBdg}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function rApontamentos(){
  const el=document.getElementById('ap-list');
  if(!apontamentos.length){el.innerHTML='<div class="empty">📝 Nenhum apontamento ainda</div>';return;}
  el.innerHTML='<div class="slbl">'+apontamentos.length+' registros</div>'+apontamentos.slice(0,50).map(a=>{
    const dt=new Date(a.timestamp);
    const dtStr=dt.toLocaleDateString('pt-BR')+' '+dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    return`<div class="apc">
      <div class="aph"><div><span class="cid">OP #${a.pedidoId}</span> <span style="font-size:12px;color:var(--text2)">${a.cliente}</span></div><span class="apt">${dtStr}</span></div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:6px">${a.produto}</div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;gap:8px;align-items:center"><span style="font-size:15px;font-weight:700;color:var(--green)">+${a.qtd} ${a.unid}</span><span class="bdg b" style="font-size:10px">${a.turno}</span></div>
        <div style="text-align:right"><div style="font-size:11px;color:var(--text3)">${a.operador}</div>${statusBadge(a.statusDepois)}</div>
      </div>
      ${a.obs?`<div style="margin-top:8px;padding:7px 9px;background:var(--bg);border-radius:var(--r);border:1px solid var(--border);font-size:12px;color:var(--text3)">${a.obs}</div>`:''}
    </div>`;
  }).join('');
}

// ===== DASHBOARD =====
function filtrarPorPeriodo(items){
  if(curPeriodo==='total') return items;
  const now=new Date();
  return items.filter(it=>{
    const dt=new Date(it.timestamp);
    if(curPeriodo==='hoje'){return dt.toDateString()===now.toDateString();}
    if(curPeriodo==='semana'){const d=(now-dt)/86400000;return d<=7;}
    if(curPeriodo==='mes'){return dt.getMonth()===now.getMonth()&&dt.getFullYear()===now.getFullYear();}
    return true;
  });
}

function rDash(){
  const total=pedidos.length;
  const conc=pedidos.filter(p=>calcStatus(p)==='Concluído').length;
  const atr=pedidos.filter(p=>calcStatus(p)==='Atrasado').length;
  const risco=pedidos.filter(p=>calcStatus(p)==='Em risco').length;
  const prazoN=pedidos.filter(p=>calcStatus(p)==='No prazo').length;
  const totP=pedidos.reduce((s,p)=>s+p.qtdPedida,0);
  const totProd=pedidos.reduce((s,p)=>s+p.qtdProduzida,0);
  const apFiltrados=filtrarPorPeriodo(apontamentos);
  document.getElementById('d-prod-metrics').innerHTML=`
    <div class="mc"><div class="ml">Total OPs</div><div class="mv" style="color:var(--bluetxt)">${total}</div><div class="ms">${apFiltrados.length} apontamentos</div></div>
    <div class="mc"><div class="ml">Concluídos</div><div class="mv" style="color:var(--greentxt)">${conc}</div><div class="ms">${pct(conc,total)}% do total</div></div>
    <div class="mc"><div class="ml">Atrasados</div><div class="mv" style="color:var(--redtxt)">${atr}</div><div class="ms">${risco} em risco</div></div>
    <div class="mc"><div class="ml">Progresso</div><div class="mv" style="color:var(--ambertxt)">${pct(totProd,totP)}%</div><div class="ms">${totProd.toLocaleString('pt-BR')}/${totP.toLocaleString('pt-BR')}</div></div>`;
  const bars=[{l:'🔴 Atrasados',v:atr,c:'var(--red)'},{l:'🟡 Em risco',v:risco,c:'var(--amber)'},{l:'🟢 No prazo',v:prazoN,c:'var(--blue)'},{l:'✅ Concluídos',v:conc,c:'var(--green)'}];
  document.getElementById('d-prod-bars').innerHTML=`<div class="obar"><div style="font-size:10px;color:var(--text2);margin-bottom:8px;font-weight:600">Distribuição por status</div>${bars.map(b=>`<div style="margin-bottom:7px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span style="color:var(--text2)">${b.l}</span><span style="font-family:var(--mono);color:var(--text)">${b.v} / ${total}</span></div><div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden"><div style="width:${pct(b.v,total)}%;height:100%;background:${b.c}"></div></div></div>`).join('')}</div>`;

  const entFiltradas=filtrarPorPeriodo(entregas);
  const entHoje=entFiltradas.length;
  const volEnt=entFiltradas.filter(e=>e.status!=='Devolvido').reduce((s,e)=>s+(e.qtd||0),0);
  const semAss=entFiltradas.filter(e=>!e.sigCli).length;
  const devs=entFiltradas.filter(e=>e.status==='Devolvido').length;
  const parc=entFiltradas.filter(e=>e.status==='Parcial').length;
  const compl=entFiltradas.filter(e=>e.status==='Entregue').length;
  const totEnt=entFiltradas.length;
  document.getElementById('d-ent-metrics').innerHTML=`
    <div class="mc"><div class="ml">Entregas</div><div class="mv" style="color:var(--greentxt)">${entHoje}</div><div class="ms">no período</div></div>
    <div class="mc"><div class="ml">Volume entregue</div><div class="mv" style="color:var(--bluetxt)">${volEnt.toLocaleString('pt-BR')}</div><div class="ms">unidades</div></div>
    <div class="mc"><div class="ml">Sem assinatura</div><div class="mv" style="color:var(--redtxt)">${semAss}</div><div class="ms">pendentes</div></div>
    <div class="mc"><div class="ml">Devoluções</div><div class="mv" style="color:var(--ambertxt)">${devs}</div><div class="ms">no período</div></div>`;
  const entBars=[{l:'✅ Completas',v:compl,c:'var(--green)'},{l:'⚠️ Parciais',v:parc,c:'var(--amber)'},{l:'↩️ Devoluções',v:devs,c:'var(--red)'}];
  document.getElementById('d-ent-bars').innerHTML=`<div class="obar"><div style="font-size:10px;color:var(--text2);margin-bottom:8px;font-weight:600">Status das entregas</div>${entBars.map(b=>`<div style="margin-bottom:7px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span style="color:var(--text2)">${b.l}</span><span style="font-family:var(--mono);color:var(--text)">${b.v} / ${totEnt||1}</span></div><div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden"><div style="width:${pct(b.v,totEnt||1)}%;height:100%;background:${b.c}"></div></div></div>`).join('')}</div>`;

  const totalEnt=entregas.filter(e=>e.status!=='Devolvido').reduce((s,e)=>s+(e.qtd||0),0);
  const estoque=totProd-totalEnt;
  document.getElementById('d-comparativo').innerHTML=`<div class="obar">
    <div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px"><span style="color:var(--text2)">📦 Total pedido</span><span style="font-family:var(--mono);font-weight:600;color:var(--text)">${totP.toLocaleString('pt-BR')} un</span></div><div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:100%;height:100%;background:var(--border2)"></div></div></div>
    <div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px"><span style="color:var(--greentxt)">⚙️ Produzido</span><span style="font-family:var(--mono);font-weight:600;color:var(--greentxt)">${totProd.toLocaleString('pt-BR')} un · ${pct(totProd,totP)}%</span></div><div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${pct(totProd,totP)}%;height:100%;background:var(--green)"></div></div></div>
    <div><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px"><span style="color:var(--bluetxt)">🚚 Entregue</span><span style="font-family:var(--mono);font-weight:600;color:var(--bluetxt)">${totalEnt.toLocaleString('pt-BR')} un · ${pct(totalEnt,totP)}%</span></div><div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${pct(totalEnt,totP)}%;height:100%;background:var(--blue)"></div></div></div>
    <div class="gap-card"><span style="font-size:11px;color:var(--purple)">📊 Em estoque (produzido não entregue)</span><span style="font-size:12px;font-weight:700;color:var(--purple);font-family:var(--mono)">${Math.max(0,estoque).toLocaleString('pt-BR')} un</span></div>
  </div>`;

  const ativ=[
    ...apFiltrados.map(a=>({tipo:'prod',ts:a.timestamp,...a})),
    ...entFiltradas.map(e=>({tipo:'ent',ts:e.timestamp,...e}))
  ].sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,8);
  const el=document.getElementById('d-atividade');
  if(!ativ.length){el.innerHTML='<div class="empty">Sem atividade no período</div>';return;}
  el.innerHTML='<div class="obar" style="padding:4px 12px">'+ativ.map((a,i)=>{
    const dt=new Date(a.ts);
    const ic=a.tipo==='prod'?'<span style="color:var(--greentxt)">⚙️</span>':'<span style="color:var(--bluetxt)">🚚</span>';
    const tit=a.tipo==='prod'?`Produção · ${a.turno||''}`:`Entrega · ${a.romaneio||''}`;
    const isLast=i===ativ.length-1;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;${isLast?'':'border-bottom:1px solid var(--border)'}">
      <div><div style="font-size:11px;color:var(--text2);display:flex;align-items:center;gap:4px">${ic}<b style="color:var(--text)">OP #${a.pedidoId}</b> · ${a.cliente}</div><div style="font-size:10px;color:var(--text3)">${tit} · ${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div></div>
      <div style="font-size:12px;font-weight:700;color:var(--greentxt)">+${a.qtd} ${a.unid||'un'}</div>
    </div>`;
  }).join('')+'</div>';
}

// ===== EXPORTAR =====
function rExport(){
  document.getElementById('exp-preview').innerHTML=`
    <div class="aba-item"><span class="aba-icon">📋</span><div class="aba-info"><div class="aba-name">Pedidos</div><div class="aba-desc">Ordens com progresso e status</div></div><span class="aba-badge">${pedidos.length} linhas</span></div>
    <div class="aba-item"><span class="aba-icon">📝</span><div class="aba-info"><div class="aba-name">Apontamentos</div><div class="aba-desc">Registros de produção</div></div><span class="aba-badge">${apontamentos.length} linhas</span></div>
    <div class="aba-item"><span class="aba-icon">🚚</span><div class="aba-info"><div class="aba-name">Entregas</div><div class="aba-desc">Romaneios e saídas</div></div><span class="aba-badge">${entregas.length} linhas</span></div>`;
}
window.exportarCSV=function(){
  const h1=['Nº OP','Produto','Cliente','Qtd Pedida','Unid','Data Pedido','Prazo','Qtd Produzida','Qtd Entregue','% Concluído','Status'];
  const r1=pedidos.map(p=>{
    const s=calcStatus(p);const pr=p.qtdPedida?Math.round(p.qtdProduzida/p.qtdPedida*100):0;
    return[p.id,p.produto,p.cliente,p.qtdPedida,p.unid,p.dataPedido,p.prazoEntrega,p.qtdProduzida,qtdEntregue(p.id),pr+'%',s].join(';');
  });
  const h2=['Data/Hora','Nº OP','Produto','Cliente','Turno','Operador','Qtd','Unid','Observações'];
  const r2=apontamentos.map(a=>[new Date(a.timestamp).toLocaleString('pt-BR'),a.pedidoId,a.produto,a.cliente,a.turno,a.operador,a.qtd,a.unid,(a.obs||'').replace(/;/g,',')].join(';'));
  const h3=['Romaneio','Data','Nº OP','Cliente','Produto','Qtd','Unid','Entregador','Conferente','Veículo','Destino','Status','Assinatura Cliente','Obs'];
  const r3=entregas.map(e=>[e.romaneio,new Date(e.timestamp).toLocaleString('pt-BR'),e.pedidoId,e.cliente,e.produto,e.qtd,e.unid,e.entregador,e.conferente,e.veiculo,e.destino,e.status,(e.sigCli?'Sim':'Não'),(e.obs||'').replace(/;/g,',')].join(';'));
  const csv='\uFEFF'+'=== PEDIDOS ===\n'+[h1.join(';'),...r1].join('\n')+'\n\n=== APONTAMENTOS ===\n'+[h2.join(';'),...r2].join('\n')+'\n\n=== ENTREGAS ===\n'+[h3.join(';'),...r3].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='producao_'+new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')+'.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  const log=document.getElementById('exp-log');
  log.className='exp-log on';
  log.innerHTML='<span class="log-ok">✓ Arquivo baixado!</span>';
};

// ===== TOPBAR =====
function updateTopbar(){
  const n=new Date();
  document.getElementById('tb-date').textContent=n.toLocaleDateString('pt-BR',{weekday:'short',day:'numeric',month:'short'})+' · '+n.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const atr=pedidos.filter(p=>calcStatus(p)==='Atrasado').length;
  document.getElementById('tb-alert').innerHTML=atr>0?`<div class="tb-badge">${atr} atras.</div>`:'';
}

// ===== INIT =====
updateTopbar();
iniciarSync();
setInterval(updateTopbar,30000);

// Esconde splash quando carregar
setTimeout(()=>{
  const splash = document.getElementById('splash');
  if(splash){
    splash.style.opacity='0';
    setTimeout(()=>splash.remove(),400);
  }
}, 1400);
