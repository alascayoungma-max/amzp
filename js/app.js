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
let entregaPedidoId=null, entregaStatus='Parcial', entregaFotoBase64='', entregaSigConf='', entregaSigCli='';
let assinaturaEntregaDocId=null, assinaturaEntregaAtual=null, assinaturaPendenteBase64='';
let salvandoEntrega = false, salvandoAssinatura = false;
let requisicoes=[];
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
function normalizarClassificacaoEntrega(status){
  if(status==='Devolvido'||status==='Devolução') return 'Devolução';
  if(status==='Entregue'||status==='Concluída'||status==='Concluido') return 'Concluída';
  return 'Parcial';
}
function classificacaoEntrega(e){return normalizarClassificacaoEntrega(e?.status);}
function statusAssinaturaEntrega(e){return e?.statusAssinatura || (e?.sigCli ? 'Concluída' : 'Aguardando assinatura');}
function badgeClassificacaoEntrega(status){
  const s=normalizarClassificacaoEntrega(status);
  if(s==='Concluída') return '<span class="badge-mini badge-ok">✅ Concluída</span>';
  if(s==='Devolução') return '<span class="badge-mini badge-danger">↩️ Devolução</span>';
  return '<span class="badge-mini badge-warn">⚠️ Parcial</span>';
}
function badgeAssinaturaEntrega(e){
  return statusAssinaturaEntrega(e)==='Concluída'
    ? '<span class="badge-mini badge-ok">✍️ Assinada</span>'
    : '<span class="badge-mini badge-warn">✍️ Pendente assinatura</span>';
}
function calcularClassificacaoEntrega(p,qtd,statusAtual=entregaStatus){
  if(normalizarClassificacaoEntrega(statusAtual)==='Devolução') return 'Devolução';
  const totalPedido=p?.qtdPedida||0;
  const totalApos=qtdEntregue(p.id)+(parseInt(qtd)||0);
  return totalPedido>0 && totalApos>=totalPedido ? 'Concluída' : 'Parcial';
}
function qtdEntregue(pedidoId){
  const total=entregas.filter(e=>e.pedidoId===pedidoId).reduce((s,e)=>s+(classificacaoEntrega(e)==='Devolução'?-(e.qtd||0):(e.qtd||0)),0);
  return Math.max(0,total);
}
function qtdEmEmpresaAntesEntrega(e){
  if(typeof e?.qtdEmEmpresaAntes==='number') return e.qtdEmEmpresaAntes;
  const p=pedidos.find(x=>x.id===e?.pedidoId);if(!p)return null;
  const ts=new Date(e.timestamp).getTime();
  const movimentoAntes=entregas.filter(x=>x.pedidoId===e.pedidoId && x.docId!==e.docId && new Date(x.timestamp).getTime()<ts).reduce((s,x)=>s+(classificacaoEntrega(x)==='Devolução'?-(x.qtd||0):(x.qtd||0)),0);
  return Math.max(0,(p.qtdProduzida||0)-movimentoAntes);
}
function qtdEmEmpresaDepoisEntrega(e){
  if(typeof e?.qtdEmEmpresaDepois==='number') return e.qtdEmEmpresaDepois;
  const antes=qtdEmEmpresaAntesEntrega(e);if(antes===null)return null;
  return classificacaoEntrega(e)==='Devolução' ? antes+(e.qtd||0) : Math.max(0,antes-(e.qtd||0));
}
function fmtQtd(v,unid){return v===null||v===undefined?'—':Number(v).toLocaleString('pt-BR')+' '+(unid||'un');}
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
function setSync(state){
  const el=document.getElementById('sync-status');if(!el)return;
  const offline=state==='err'||!navigator.onLine;
  el.textContent=offline?'📴 offline · dados salvos no aparelho':'☁️ online';
  el.style.color=offline?'var(--ambertxt)':'var(--text3)';
}
window.addEventListener('online',()=>setSync('ok'));
window.addEventListener('offline',()=>setSync('err'));

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
      setSync('ok');
    }
  },()=>setSync('err'));
  const qAp = query(collection(db,'apontamentos'), orderBy('timestamp','desc'));
  onSnapshot(qAp, snap=>{
    apontamentos = snap.docs.map(d=>({...d.data(), docId:d.id}));
    if(document.getElementById('scr-ap').classList.contains('on')) rApontamentos();
    if(document.getElementById('scr-dash').classList.contains('on')) rDash();
  },()=>setSync('err'));
  const qEnt = query(collection(db,'entregas'), orderBy('timestamp','desc'));
  onSnapshot(qEnt, snap=>{
    entregas = snap.docs.map(d=>({...d.data(), docId:d.id}));
    if(document.getElementById('scr-entrega').classList.contains('on')) rEntregas();
    if(document.getElementById('scr-dash').classList.contains('on')) rDash();
    rPedidos();
  },()=>setSync('err'));
}

async function savePedido(p){ await setDoc(doc(db,'pedidos',p.id), p); }
async function saveApontamento(ap){ await addDoc(collection(db,'apontamentos'), ap); }
async function saveEntrega(ent){ await addDoc(collection(db,'entregas'), ent); }
async function updateEntrega(docIdEnt, ent){
  const payload={...ent};
  delete payload.docId;
  await setDoc(doc(db,'entregas',docIdEnt), payload);
}

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
  if(name==='req') rReq();
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
  entregaPedidoId=null; entregaStatus='Parcial';
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
  window.setStatusEntrega('Parcial');
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
  const estoqueEmpresa=Math.max(0,(p.qtdProduzida||0)-ent);
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
      <span>📦 Pedido <b style="color:var(--text)">${p.qtdPedida}</b></span>
      <span>⚙️ Produzido <b style="color:var(--greentxt)">${p.qtdProduzida}</b></span>
      <span>🏢 Empresa <b style="color:var(--ambertxt)">${estoqueEmpresa}</b></span>
      <span>🚚 Saiu <b style="color:var(--bluetxt)">${ent}</b></span>
    </div>`;
  card.style.display='block';
  window.updateSaldoEntrega();
};
window.chQtyE=function(d){
  if(!entregaPedidoId)return;
  const p=pedidos.find(x=>x.id===entregaPedidoId);if(!p)return;
  const ent=qtdEntregue(entregaPedidoId);
  const max=Math.max(0,(p.qtdProduzida||0)-ent);
  const cur=parseInt(document.getElementById('e-qty').value)||0;
  document.getElementById('e-qty').value=Math.max(0,Math.min(max,cur+d));
  window.updateSaldoEntrega();
};
window.updateSaldoEntrega=function(){
  if(!entregaPedidoId){document.getElementById('e-saldo').style.display='none';return;}
  const p=pedidos.find(x=>x.id===entregaPedidoId);if(!p)return;
  const ent=qtdEntregue(entregaPedidoId);
  const novo=parseInt(document.getElementById('e-qty').value)||0;
  const max=Math.max(0,(p.qtdProduzida||0)-ent);
  if(novo>max){document.getElementById('e-qty').value=max;}
  const qtdAtual=parseInt(document.getElementById('e-qty').value)||0;
  const restante=max-qtdAtual;
  const unid=document.getElementById('e-unid').value;
  const el=document.getElementById('e-saldo');
  el.style.display='flex';
  el.innerHTML=`<span style="font-size:11px;color:var(--green)">Na empresa após essa saída</span><span style="font-size:12px;font-weight:700;color:var(--greentxt)">${restante} ${unid} restantes</span>`;
  if(normalizarClassificacaoEntrega(entregaStatus)!=='Devolução') window.setStatusEntrega('Parcial');
};
window.setStatusEntrega=function(s){
  let normal=normalizarClassificacaoEntrega(s);
  if(normal!=='Devolução' && entregaPedidoId){
    const p=pedidos.find(x=>x.id===entregaPedidoId);
    if(p) normal=calcularClassificacaoEntrega(p,document.getElementById('e-qty').value,normal);
  }
  entregaStatus=normal;
  document.getElementById('st-entregue').className='st-pill'+(normal==='Concluída'?' on-g':'');
  document.getElementById('st-parcial').className='st-pill'+(normal==='Parcial'?' on-a':'');
  document.getElementById('st-devolvido').className='st-pill'+(normal==='Devolução'?' on-r':'');
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
const sigState = {conf:{drawing:false,empty:true,ctx:null,canvas:null},cli:{drawing:false,empty:true,ctx:null,canvas:null},'cli-pendente':{drawing:false,empty:true,ctx:null,canvas:null}};
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
  const s=sigState[tipo];if(!s||!s.ctx)return;
  s.ctx.clearRect(0,0,s.canvas.width,s.canvas.height);
  s.empty=true;
  document.getElementById('sig-hint-'+tipo).classList.remove('hidden');
  document.getElementById('sig-pad-'+tipo).classList.remove('signed');
  if(tipo==='conf') entregaSigConf='';
  else if(tipo==='cli') entregaSigCli='';
  else if(tipo==='cli-pendente') assinaturaPendenteBase64='';
};
window.confirmSig=function(tipo){
  const s=sigState[tipo];if(!s||!s.ctx||s.empty){showToast('⚠️ Assine primeiro');return;}
  const data=s.canvas.toDataURL('image/png');
  if(tipo==='conf') entregaSigConf=data;
  else if(tipo==='cli') entregaSigCli=data;
  else if(tipo==='cli-pendente') assinaturaPendenteBase64=data;
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
    const qtdJaEntregueAntes=qtdEntregue(entregaPedidoId);
    const qtdEmEmpresaAntes=Math.max(0,(p.qtdProduzida||0)-qtdJaEntregueAntes);
    const classificacao=calcularClassificacaoEntrega(p,qtd,entregaStatus);
    const qtdEmEmpresaDepois=classificacao==='Devolução' ? qtdEmEmpresaAntes+qtd : Math.max(0,qtdEmEmpresaAntes-qtd);
    const statusAssinatura=entregaSigCli ? 'Concluída' : 'Aguardando assinatura';
    const agora=new Date().toISOString();
    const ent={
      romaneio, pedidoId:entregaPedidoId, cliente:p.cliente, produto:p.produto, qtd,
      unid:document.getElementById('e-unid').value,
      entregador:document.getElementById('e-entregador').value.trim(),
      conferente,
      veiculo:document.getElementById('e-veiculo').value.trim(),
      destino:document.getElementById('e-destino').value.trim(),
      status:classificacao, statusAssinatura, obs:document.getElementById('e-obs').value.trim(),
      qtdPedidaRegistro:p.qtdPedida||0,
      qtdProduzidaRegistro:p.qtdProduzida||0,
      qtdJaEntregueAntes,
      qtdEmEmpresaAntes,
      qtdEmEmpresaDepois,
      foto:entregaFotoBase64, sigConf:entregaSigConf, sigCli:entregaSigCli,
      assinaturaClienteEm:entregaSigCli ? agora : '',
      data:hoje(), timestamp:agora
    };
    await saveEntrega(ent);
    window.closeEntrega();
    showToast(statusAssinatura==='Aguardando assinatura' ? '✅ Entrega '+romaneio+' salva. Assinatura pendente.' : '✅ Entrega '+romaneio+' registrada!');
  } catch(err) {
    showToast('⚠️ Erro ao salvar: '+err.message);
  } finally {
    salvandoEntrega = false;
    btnSalvar.textContent = btnTextoOriginal;
    btnSalvar.style.opacity = '1';
    btnSalvar.disabled = false;
  }
};

window.openColetarAssinatura=function(docIdEnt){
  const e=entregas.find(x=>x.docId===docIdEnt);if(!e)return;
  assinaturaEntregaDocId=docIdEnt;
  assinaturaEntregaAtual=e;
  assinaturaPendenteBase64='';
  const dt=new Date(e.timestamp);
  document.getElementById('as-info').innerHTML=`
    <div class="delivery-badges" style="margin-bottom:8px">${badgeAssinaturaEntrega(e)}${badgeClassificacaoEntrega(classificacaoEntrega(e))}</div>
    <div class="irow" style="padding-top:0"><span class="ilbl">Romaneio</span><span class="ival">${e.romaneio||'—'}</span></div>
    <div class="irow"><span class="ilbl">Pedido</span><span class="ival">OP #${e.pedidoId||'—'}</span></div>
    <div class="irow"><span class="ilbl">Cliente</span><span class="ival">${e.cliente||'—'}</span></div>
    <div class="irow"><span class="ilbl">Produto</span><span class="ival">${e.produto||'—'}</span></div>
    <div class="irow"><span class="ilbl">Quantidade entregue</span><span class="ival">${fmtQtd(e.qtd,e.unid)}</span></div>
    <div class="irow"><span class="ilbl">Na empresa antes</span><span class="ival">${fmtQtd(qtdEmEmpresaAntesEntrega(e),e.unid)}</span></div>
    <div class="irow" style="padding-bottom:0"><span class="ilbl">Data</span><span class="ival">${dt.toLocaleDateString('pt-BR')}</span></div>`;
  document.getElementById('modal-assinatura').classList.add('on');
  document.getElementById('mdl-assinatura').scrollTop=0;
  setTimeout(()=>{initSig('cli-pendente');},150);
};
window.closeAssinatura=function(){
  document.getElementById('modal-assinatura').classList.remove('on');
  assinaturaEntregaDocId=null; assinaturaEntregaAtual=null; assinaturaPendenteBase64='';
};
window.ovClickAssinatura=function(e){if(e.target===document.getElementById('modal-assinatura'))window.closeAssinatura();};
window.salvarAssinaturaCliente=async function(){
  if(salvandoAssinatura)return;
  if(!assinaturaEntregaDocId||!assinaturaEntregaAtual){showToast('⚠️ Entrega não encontrada');return;}
  if(!assinaturaPendenteBase64){showToast('⚠️ Confirme a assinatura do cliente');return;}
  salvandoAssinatura=true;
  const btn=document.getElementById('as-save');
  const txt=btn.textContent;
  btn.textContent='⏳ Salvando...';btn.disabled=true;btn.style.opacity='0.6';
  try{
    const atualizada={...assinaturaEntregaAtual,sigCli:assinaturaPendenteBase64,statusAssinatura:'Concluída',assinaturaClienteEm:new Date().toISOString()};
    await updateEntrega(assinaturaEntregaDocId,atualizada);
    window.closeAssinatura();
    showToast('✅ Assinatura do cliente salva!');
  }catch(err){showToast('⚠️ Erro ao salvar assinatura: '+err.message);}
  finally{salvandoAssinatura=false;btn.textContent=txt;btn.disabled=false;btn.style.opacity='1';}
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
    const pendente=statusAssinaturaEntrega(e)==='Aguardando assinatura';
    const classif=classificacaoEntrega(e);
    const antes=qtdEmEmpresaAntesEntrega(e);
    const depois=qtdEmEmpresaDepoisEntrega(e);
    return `<div class="delivery-card ${pendente?'pending-signature':'done-signature'}">
      <div class="delivery-head">
        <div>
          <span class="cid">OP #${e.pedidoId}</span>
          <span class="delivery-client">${e.cliente||'—'}</span>
        </div>
        <div class="delivery-date">${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>

      <div class="delivery-title">${e.produto||'—'}</div>
      <div class="delivery-rom">Romaneio <b>${e.romaneio||'—'}</b></div>

      <div class="delivery-stock">
        <div><span>Pedido</span><strong>OP #${e.pedidoId||'—'}</strong></div>
        <div><span>Produto</span><strong>${e.produto||'—'}</strong></div>
        <div><span>Na empresa antes da saída</span><strong>${fmtQtd(antes,e.unid)}</strong></div>
        <div><span>Na empresa depois</span><strong>${fmtQtd(depois,e.unid)}</strong></div>
      </div>

      <div class="delivery-foot">
        <div class="delivery-people">🚚 ${e.entregador||'—'} · 🔍 ${e.conferente||'—'} · 🚗 ${e.veiculo||'—'}</div>
        <div class="delivery-qty">${fmtQtd(e.qtd,e.unid)}</div>
      </div>

      <div class="delivery-actions">
        <div class="delivery-badges">${badgeClassificacaoEntrega(classif)}${badgeAssinaturaEntrega(e)}</div>
        <div class="delivery-buttons">
          ${pendente?`<button class="mini-action" onclick="openColetarAssinatura('${e.docId}')">Coletar assinatura</button>`:''}
          <button class="icon-action danger" onclick="excluirEntrega('${e.docId}','${e.romaneio||''}')" title="Excluir">🗑️</button>
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

// ===== REQUISIÇÕES (RM / RC) =====
let rmItens=[], rcItens=[], reqSigs={}, subReq='rm';
let almoxRMId=null, almoxItens=[], recebRMId=null, rcEditId=null, rcRecebId=null;
let salvandoRM=false, salvandoAlmox=false, salvandoReceb=false, salvandoRC=false, salvandoRCreceb=false;

function escHtml(value){
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function csvCell(value){return '"'+String(value??'').replace(/"/g,'""')+'"';}

function iniciarSyncReq(){
  const qReq=query(collection(db,'requisicoes'),orderBy('timestamp','desc'));
  onSnapshot(qReq,snap=>{
    requisicoes=snap.docs.map(d=>({...d.data(),docId:d.id}));
    updateReqBadge();
    if(document.getElementById('scr-req')?.classList.contains('on')) rReq();
    if(document.getElementById('scr-dash')?.classList.contains('on')) rDash();
    if(document.getElementById('scr-export')?.classList.contains('on')) rExport();
  },()=>setSync('err'));
}

async function gerarNumReq(tipo){
  const ref=doc(db,'contadores',tipo);
  try{
    const novo=await runTransaction(db,async tx=>{
      const snap=await tx.get(ref);
      const next=(snap.exists()?snap.data().valor:0)+1;
      tx.set(ref,{valor:next});
      return next;
    });
    return `${tipo.toUpperCase()} #${String(novo).padStart(4,'0')}`;
  }catch{
    return `${tipo.toUpperCase()} #${String(Date.now()).slice(-4)}`;
  }
}
async function previewNumReq(tipo){
  try{
    const snap=await getDocs(collection(db,'contadores'));
    const contador=snap.docs.find(item=>item.id===tipo);
    return `${tipo.toUpperCase()} #${String((contador?contador.data().valor:0)+1).padStart(4,'0')}`;
  }catch{return `${tipo.toUpperCase()} #0001`;}
}

function setSubReq(tipo){
  subReq=tipo;
  document.getElementById('sub-rm').className='subtab'+(tipo==='rm'?' on-rm':'');
  document.getElementById('sub-rc').className='subtab'+(tipo==='rc'?' on-rc':'');
  document.getElementById('req-rm-wrap').hidden=tipo!=='rm';
  document.getElementById('req-rc-wrap').hidden=tipo!=='rc';
  rReq();
}
window.setSubReq=setSubReq;

function reqStatusLabel(status){
  return ({aguardando_almoxarifado:'Aguardando almoxarifado',pronto_retirada:'Pronto para retirada',concluido:'Concluído',aberta:'Aberta',finalizada:'Enviada',enviada:'Enviada',recebida:'Recebida'})[status]||status||'—';
}
function reqStatusBadge(status){
  const map={
    aguardando_almoxarifado:['⏳ Aguardando almox.','a'], pronto_retirada:['📦 Pronto p/ retirada','b'],
    concluido:['✅ Concluído','g'], aberta:['⏳ Aberta','a'], finalizada:['🛒 Enviada','b'],
    enviada:['🛒 Enviada','b'], recebida:['✅ Recebida','g']
  };
  const [label,classe]=map[status]||['—','b'];
  return `<span class="bdg ${classe}">${label}</span>`;
}

function rReq(){
  const rms=requisicoes.filter(r=>r.tipo==='RM');
  const rcs=requisicoes.filter(r=>r.tipo==='RC');
  document.getElementById('rm-list').innerHTML=rms.length?rms.map(reqCardHTML).join(''):'<div class="empty">🧾 Nenhuma RM registrada ainda</div>';
  document.getElementById('rc-list').innerHTML=rcs.length?rcs.map(reqCardHTML).join(''):'<div class="empty">🛒 Nenhuma RC registrada ainda</div>';
}
function reqCardHTML(req){
  const dt=new Date(req.timestamp);
  const itens=req.itens||[];
  const resumo=itens.slice(0,2).map(item=>item.material).join(', ')+(itens.length>2?` +${itens.length-2}`:'');
  return `<article class="req-card" onclick="abrirReq('${req.docId}')">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:5px">
      <div><span class="cid">${escHtml(req.numero)}</span><div style="font-size:13px;font-weight:700;margin-top:2px">${escHtml(req.solicitante||'—')}${req.setor?' · '+escHtml(req.setor):''}</div></div>
      ${reqStatusBadge(req.status)}
    </div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:6px">${escHtml(resumo||'—')}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:7px;border-top:1px solid var(--border)"><span style="font-size:11px;color:var(--text3)">${itens.length} ${itens.length===1?'item':'itens'}</span><span class="apt">${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span></div>
  </article>`;
}

const REQ_UNITS=['un','m','m²','m³','rolo','kg'];
function unitOptions(selected){return REQ_UNITS.map(u=>`<option value="${u}"${u===selected?' selected':''}>${u}</option>`).join('');}
function renderRMItens(){
  document.getElementById('rm-itens').innerHTML=rmItens.map((item,i)=>`<div class="item-row">
    <div class="item-row-top"><span style="font-size:11px;color:var(--text3);font-weight:700">Item ${i+1}</span>${rmItens.length>1?`<button class="item-del" onclick="delItemRM(${i})">🗑 remover</button>`:''}</div>
    <input value="${escHtml(item.material)}" oninput="upRM(${i},'material',this.value)" placeholder="Material / produto" class="req-input">
    <div class="qty-wrap"><div class="unit-sel"><select onchange="upRM(${i},'unid',this.value)">${unitOptions(item.unid)}</select></div><input type="number" inputmode="numeric" min="1" value="${escHtml(item.qtd)}" oninput="upRM(${i},'qtd',this.value)" placeholder="Qtd" class="req-qty"></div>
  </div>`).join('');
}
window.upRM=(i,campo,valor)=>{rmItens[i][campo]=valor;};
window.addItemRM=()=>{rmItens.push({material:'',unid:'un',qtd:''});renderRMItens();};
window.delItemRM=i=>{rmItens.splice(i,1);if(!rmItens.length)rmItens.push({material:'',unid:'un',qtd:''});renderRMItens();};

function clearSigReq(tipo){
  const state=sigState[tipo];
  if(!state?.ctx)return;
  state.ctx.clearRect(0,0,state.canvas.width,state.canvas.height);
  state.empty=true;reqSigs[tipo]='';
  document.getElementById(`sig-hint-${tipo}`).classList.remove('hidden');
  document.getElementById(`sig-pad-${tipo}`).classList.remove('signed');
}
function confirmSigReq(tipo){
  const state=sigState[tipo];
  if(!state?.ctx||state.empty){showToast('⚠️ Assine primeiro');return;}
  reqSigs[tipo]=state.canvas.toDataURL('image/png');
  document.getElementById(`sig-pad-${tipo}`).classList.add('signed');
  showToast('✓ Assinatura confirmada');
}
window.clearSigReq=clearSigReq;window.confirmSigReq=confirmSigReq;

function prepareReqSignature(tipo){
  sigState[tipo]={drawing:false,empty:true,ctx:null,canvas:null};
  setTimeout(()=>initSig(tipo),100);
}
async function openNovaRM(){
  rmItens=[{material:'',unid:'un',qtd:''}];reqSigs.rmsol='';renderRMItens();
  ['rm-solic','rm-setor','rm-obs'].forEach(id=>{document.getElementById(id).value='';});
  const now=new Date();
  document.getElementById('rm-data').textContent=now.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
  document.getElementById('rm-num').textContent=await previewNumReq('rm');
  document.getElementById('modal-rm').classList.add('on');document.getElementById('mdl-rm').scrollTop=0;
  prepareReqSignature('rmsol');
}
window.openNovaRM=openNovaRM;
window.closeRM=()=>document.getElementById('modal-rm').classList.remove('on');
window.ovClickRM=e=>{if(e.target.id==='modal-rm')window.closeRM();};

async function salvarRM(){
  if(salvandoRM)return;
  const solicitante=document.getElementById('rm-solic').value.trim();
  const itens=rmItens.filter(i=>i.material.trim()&&Number(i.qtd)>0);
  if(!solicitante){showToast('⚠️ Informe o solicitante');return;}
  if(!itens.length){showToast('⚠️ Adicione ao menos um item');return;}
  if(!reqSigs.rmsol){showToast('⚠️ Confirme a assinatura');return;}
  salvandoRM=true;const btn=document.querySelector('#mdl-rm .btn-g');const label=btn.textContent;btn.disabled=true;btn.textContent='⏳ Salvando...';
  try{
    const numero=await gerarNumReq('rm');
    await addDoc(collection(db,'requisicoes'),{
      tipo:'RM',numero,solicitante,setor:document.getElementById('rm-setor').value.trim(),obs:document.getElementById('rm-obs').value.trim(),
      itens:itens.map(i=>({material:i.material.trim(),unid:i.unid||'un',qtd:Number(i.qtd),statusAlmox:null,qtdLiberada:null})),
      sigSolicitante:reqSigs.rmsol,sigAlmox:'',sigRecebedor:'',status:'aguardando_almoxarifado',data:hoje(),timestamp:new Date().toISOString()
    });
    window.closeRM();showToast(`✅ ${numero} enviada ao almoxarifado`);
  }catch(error){showToast(`⚠️ Erro ao salvar: ${error.message}`);}
  finally{salvandoRM=false;btn.disabled=false;btn.textContent=label;}
}
window.salvarRM=salvarRM;

function openAlmoxRM(id){
  const req=requisicoes.find(r=>r.docId===id);if(!req)return;
  almoxRMId=id;reqSigs.almox='';
  almoxItens=(req.itens||[]).map(item=>({...item,statusAlmox:item.statusAlmox||null,qtdLiberada:item.qtdLiberada??null}));
  document.getElementById('almox-num').textContent=req.numero;
  document.getElementById('almox-solic').textContent=(req.solicitante||'—')+(req.setor?` · ${req.setor}`:'');
  document.getElementById('almox-obs-wrap').hidden=!req.obs;document.getElementById('almox-obs').textContent=req.obs||'';
  document.getElementById('almox-data').textContent=new Date(req.timestamp).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
  document.getElementById('almox-nome').value=req.almoxarife||'';renderAlmoxItens();
  document.getElementById('modal-almox').classList.add('on');document.getElementById('mdl-almox').scrollTop=0;prepareReqSignature('almox');
}
window.openAlmoxRM=openAlmoxRM;
function renderAlmoxItens(){
  document.getElementById('almox-itens').innerHTML=almoxItens.map((item,i)=>`<div class="item-row">
    <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:8px"><strong>${escHtml(item.material)}</strong><span style="font-size:11px;color:var(--text2)">Pedido: <b>${item.qtd} ${escHtml(item.unid)}</b></span></div>
    <div class="status-pills"><button class="st-pill${item.statusAlmox==='sim'?' on-g':''}" onclick="setAlmoxStatus(${i},'sim')">✅ Sim</button><button class="st-pill${item.statusAlmox==='parcial'?' on-a':''}" onclick="setAlmoxStatus(${i},'parcial')">⚠️ Parcial</button><button class="st-pill${item.statusAlmox==='nao'?' on-r':''}" onclick="setAlmoxStatus(${i},'nao')">❌ Não</button></div>
    ${item.statusAlmox==='parcial'?`<label class="partial-label">Quantidade liberada<input type="number" min="1" max="${item.qtd}" value="${item.qtdLiberada??''}" oninput="upAlmoxQtd(${i},this.value)" class="req-qty partial"></label>`:''}
  </div>`).join('');
}
window.setAlmoxStatus=(i,status)=>{almoxItens[i].statusAlmox=status;almoxItens[i].qtdLiberada=status==='sim'?almoxItens[i].qtd:status==='nao'?0:null;renderAlmoxItens();};
window.upAlmoxQtd=(i,valor)=>{almoxItens[i].qtdLiberada=Math.max(0,Math.min(almoxItens[i].qtd,Number(valor)||0));};
window.closeAlmox=()=>document.getElementById('modal-almox').classList.remove('on');
window.ovClickAlmox=e=>{if(e.target.id==='modal-almox')window.closeAlmox();};

async function salvarAlmox(){
  if(salvandoAlmox)return;
  if(almoxItens.some(i=>!i.statusAlmox)){showToast('⚠️ Defina o status de todos os itens');return;}
  if(almoxItens.some(i=>i.statusAlmox==='parcial'&&(i.qtdLiberada<1||i.qtdLiberada>=i.qtd))){showToast('⚠️ A quantidade parcial deve ser menor que a pedida');return;}
  if(!document.getElementById('almox-nome').value.trim()){showToast('⚠️ Informe o nome do almoxarife');return;}
  if(!reqSigs.almox){showToast('⚠️ Confirme a assinatura');return;}
  salvandoAlmox=true;const btn=document.querySelector('#mdl-almox .btn-g');const label=btn.textContent;btn.disabled=true;btn.textContent='⏳ Salvando...';
  try{
    const req=requisicoes.find(r=>r.docId===almoxRMId);
    await setDoc(doc(db,'requisicoes',almoxRMId),{itens:almoxItens,almoxarife:document.getElementById('almox-nome').value.trim(),sigAlmox:reqSigs.almox,status:'pronto_retirada',timestampAlmox:new Date().toISOString()},{merge:true});
    window.closeAlmox();showToast(`📦 ${req.numero} liberada para retirada`);
  }catch(error){showToast(`⚠️ Erro: ${error.message}`);}
  finally{salvandoAlmox=false;btn.disabled=false;btn.textContent=label;}
}
window.salvarAlmox=salvarAlmox;

function itemStatusBadge(item){
  if(item.statusAlmox==='sim')return `<span class="bdg g">✅ ${item.qtdLiberada} ${escHtml(item.unid)}</span>`;
  if(item.statusAlmox==='parcial')return `<span class="bdg a">⚠️ ${item.qtdLiberada}/${item.qtd} ${escHtml(item.unid)}</span>`;
  if(item.statusAlmox==='nao')return '<span class="bdg r">❌ Sem estoque</span>';
  return '<span class="bdg b">⏳ Pendente</span>';
}
function sigThumb(label,image){
  if(!String(image||'').startsWith('data:image/'))return '';
  return `<div class="sig-thumb"><span>${escHtml(label)}</span><div><img src="${image}" alt="Assinatura: ${escHtml(label)}"></div></div>`;
}
function verRM(id){
  const req=requisicoes.find(r=>r.docId===id);if(!req)return;
  document.getElementById('ver-title').textContent=req.numero;document.getElementById('ver-sub').textContent=(req.solicitante||'—')+(req.setor?` · ${req.setor}`:'');
  const itens=(req.itens||[]).map(item=>`<div class="item-row req-detail"><div><strong>${escHtml(item.material)}</strong><small>Pedido: ${item.qtd} ${escHtml(item.unid)}</small></div>${itemStatusBadge(item)}</div>`).join('');
  const assinaturas=[sigThumb('Solicitante',req.sigSolicitante),sigThumb('Almoxarife',req.sigAlmox),sigThumb('Recebedor',req.sigRecebedor)].filter(Boolean).join('');
  const rcInfo=req.rcNumero?`<div class="gap-card"><span>🛒 RC de compra gerada</span><strong>${escHtml(req.rcNumero)}</strong></div>`:req.temPendenciaCompra?`<button class="btn btn-b" style="margin-top:14px" onclick="gerarRCdeRM('${req.docId}')">🛒 Gerar RC das faltas</button>`:'';
  document.getElementById('ver-body').innerHTML=`<div class="req-detail-head">${reqStatusBadge(req.status)}${req.obs?`<p>📝 ${escHtml(req.obs)}</p>`:''}</div>${itens}${assinaturas?`<div class="sig-thumbs">${assinaturas}</div>`:''}${rcInfo}`;
  document.getElementById('modal-ver').classList.add('on');document.getElementById('mdl-ver').scrollTop=0;
}
window.verRM=verRM;window.closeVer=()=>document.getElementById('modal-ver').classList.remove('on');window.ovClickVer=e=>{if(e.target.id==='modal-ver')window.closeVer();};

function openRecebRM(id){
  const req=requisicoes.find(r=>r.docId===id);if(!req)return;
  recebRMId=id;reqSigs.receb='';document.getElementById('receb-num').textContent=req.numero;
  document.getElementById('receb-solic').textContent=(req.solicitante||'—')+(req.setor?` · ${req.setor}`:'');document.getElementById('receb-nome').value=req.solicitante||'';
  document.getElementById('receb-itens').innerHTML=(req.itens||[]).map(item=>{
    const info=item.statusAlmox==='sim'?`Retirar ${item.qtdLiberada} ${item.unid}`:item.statusAlmox==='parcial'?`Retirar ${item.qtdLiberada} de ${item.qtd} ${item.unid}`:'Indisponível (compra)';
    const color=item.statusAlmox==='sim'?'var(--greentxt)':item.statusAlmox==='parcial'?'var(--ambertxt)':'var(--redtxt)';
    return `<div class="item-row req-detail"><strong>${escHtml(item.material)}</strong><span style="color:${color}">${escHtml(info)}</span></div>`;
  }).join('');
  document.getElementById('receb-aviso').hidden=!(req.itens||[]).some(i=>i.statusAlmox==='nao'||i.statusAlmox==='parcial');
  document.getElementById('modal-receb').classList.add('on');document.getElementById('mdl-receb').scrollTop=0;prepareReqSignature('receb');
}
window.openRecebRM=openRecebRM;window.closeReceb=()=>document.getElementById('modal-receb').classList.remove('on');window.ovClickReceb=e=>{if(e.target.id==='modal-receb')window.closeReceb();};

async function salvarReceb(){
  if(salvandoReceb)return;
  const nome=document.getElementById('receb-nome').value.trim();if(!nome){showToast('⚠️ Informe quem está recebendo');return;}if(!reqSigs.receb){showToast('⚠️ Confirme a assinatura');return;}
  salvandoReceb=true;const btn=document.querySelector('#mdl-receb .btn-g');const label=btn.textContent;btn.disabled=true;btn.textContent='⏳ Salvando...';
  try{
    const req=requisicoes.find(r=>r.docId===recebRMId);const temFalta=(req.itens||[]).some(i=>i.statusAlmox==='nao'||i.statusAlmox==='parcial');
    await setDoc(doc(db,'requisicoes',recebRMId),{recebedor:nome,sigRecebedor:reqSigs.receb,status:'concluido',rcGerada:false,temPendenciaCompra:temFalta,timestampReceb:new Date().toISOString()},{merge:true});
    if(temFalta)await gerarRCdeRM(recebRMId,true);
    window.closeReceb();showToast(`✅ ${req.numero} concluída${temFalta?' — RC gerada':''}`);
  }catch(error){showToast(`⚠️ Erro: ${error.message}`);}
  finally{salvandoReceb=false;btn.disabled=false;btn.textContent=label;}
}
window.salvarReceb=salvarReceb;

function abrirReq(id){
  const req=requisicoes.find(r=>r.docId===id);if(!req)return;
  if(req.tipo==='RC'){req.status==='aberta'?openFinalizarRC(id):verRC(id);return;}
  if(req.status==='aguardando_almoxarifado'){openAlmoxRM(id);return;}
  if(req.status==='pronto_retirada'){openRecebRM(id);return;}
  verRM(id);
}
window.abrirReq=abrirReq;

async function gerarRCdeRM(rmId,silencioso=false){
  const req=requisicoes.find(r=>r.docId===rmId);if(!req)return;
  if(req.rcGerada){if(!silencioso)showToast('ℹ️ RC já gerada para esta RM');return;}
  const faltas=(req.itens||[]).filter(i=>i.statusAlmox==='nao'||i.statusAlmox==='parcial').map(i=>({material:i.material,unid:i.unid,qtd:i.statusAlmox==='nao'?i.qtd:i.qtd-(i.qtdLiberada||0),origem:i.statusAlmox})).filter(i=>i.qtd>0);
  if(!faltas.length){await setDoc(doc(db,'requisicoes',rmId),{rcGerada:true,temPendenciaCompra:false},{merge:true});if(!silencioso)showToast('ℹ️ Nenhuma falta para compra');return;}
  const numero=await gerarNumReq('rc');
  await addDoc(collection(db,'requisicoes'),{tipo:'RC',numero,origemRM:req.numero,origemRMId:rmId,solicitante:req.solicitante,setor:req.setor||'',obs:req.obs||'',itens:faltas,sigSolicitante:'',status:'aberta',data:hoje(),timestamp:new Date().toISOString()});
  await setDoc(doc(db,'requisicoes',rmId),{rcGerada:true,rcNumero:numero},{merge:true});
  if(!silencioso){window.closeVer();showToast(`🛒 ${numero} gerada das faltas de ${req.numero}`);}
}
window.gerarRCdeRM=gerarRCdeRM;

function renderRCItens(){
  document.getElementById('rc-itens').innerHTML=rcItens.map((item,i)=>`<div class="item-row">
    <div class="item-row-top"><span style="font-size:11px;color:var(--text3);font-weight:700">Item ${i+1}${item.origem==='nao'?' · sem estoque':item.origem==='parcial'?' · faltante':''}</span>${rcItens.length>1?`<button class="item-del" onclick="delItemRC(${i})">🗑 remover</button>`:''}</div>
    <input value="${escHtml(item.material)}" oninput="upRC(${i},'material',this.value)" placeholder="Material / produto" class="req-input">
    <div class="qty-wrap"><div class="unit-sel"><select onchange="upRC(${i},'unid',this.value)">${unitOptions(item.unid)}</select></div><input type="number" min="1" value="${escHtml(item.qtd)}" oninput="upRC(${i},'qtd',this.value)" placeholder="Qtd" class="req-qty"></div>
  </div>`).join('');
}
window.upRC=(i,campo,valor)=>{rcItens[i][campo]=valor;};window.addItemRC=()=>{rcItens.push({material:'',unid:'un',qtd:'',origem:'manual'});renderRCItens();};window.delItemRC=i=>{rcItens.splice(i,1);if(!rcItens.length)rcItens.push({material:'',unid:'un',qtd:'',origem:'manual'});renderRCItens();};

async function openNovaRC(){
  rcEditId=null;rcItens=[{material:'',unid:'un',qtd:'',origem:'manual'}];reqSigs.rcsol='';renderRCItens();
  document.getElementById('rc-title').textContent='Nova requisição de compra';document.getElementById('rc-sub').textContent='Solicitação ao setor de compras';
  ['rc-solic','rc-setor','rc-obs'].forEach(id=>{document.getElementById(id).value='';});
  const now=new Date();document.getElementById('rc-data').textContent=now.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});document.getElementById('rc-num').textContent=await previewNumReq('rc');
  document.getElementById('modal-rc').classList.add('on');document.getElementById('mdl-rc').scrollTop=0;prepareReqSignature('rcsol');
}
window.openNovaRC=openNovaRC;
function openFinalizarRC(id){
  const req=requisicoes.find(r=>r.docId===id);if(!req)return;
  rcEditId=id;rcItens=(req.itens||[]).map(item=>({...item,origem:item.origem||'manual'}));if(!rcItens.length)rcItens=[{material:'',unid:'un',qtd:'',origem:'manual'}];reqSigs.rcsol='';renderRCItens();
  document.getElementById('rc-title').textContent=`Finalizar ${req.numero}`;document.getElementById('rc-sub').textContent=req.origemRM?`Gerada da ${req.origemRM} — confira e assine`:'Confira os itens e assine';
  document.getElementById('rc-solic').value=req.solicitante||'';document.getElementById('rc-setor').value=req.setor||'';document.getElementById('rc-obs').value=req.obs||'';document.getElementById('rc-num').textContent=req.numero;document.getElementById('rc-data').textContent=new Date(req.timestamp).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
  document.getElementById('modal-rc').classList.add('on');document.getElementById('mdl-rc').scrollTop=0;prepareReqSignature('rcsol');
}
window.openFinalizarRC=openFinalizarRC;window.closeRC=()=>document.getElementById('modal-rc').classList.remove('on');window.ovClickRC=e=>{if(e.target.id==='modal-rc')window.closeRC();};

async function salvarRC(){
  if(salvandoRC)return;
  const solicitante=document.getElementById('rc-solic').value.trim();const itens=rcItens.filter(i=>i.material.trim()&&Number(i.qtd)>0);
  if(!solicitante){showToast('⚠️ Informe o solicitante');return;}if(!itens.length){showToast('⚠️ Adicione ao menos um item');return;}if(!reqSigs.rcsol){showToast('⚠️ Confirme a assinatura');return;}
  salvandoRC=true;const btn=document.querySelector('#mdl-rc .btn-g');const label=btn.textContent;btn.disabled=true;btn.textContent='⏳ Gerando...';
  try{
    const payload={solicitante,setor:document.getElementById('rc-setor').value.trim(),obs:document.getElementById('rc-obs').value.trim(),itens:itens.map(i=>({material:i.material.trim(),unid:i.unid||'un',qtd:Number(i.qtd),origem:i.origem||'manual'})),sigSolicitante:reqSigs.rcsol,status:'finalizada',timestampFinal:new Date().toISOString()};
    let rcDoc;
    if(rcEditId){const anterior=requisicoes.find(r=>r.docId===rcEditId);await setDoc(doc(db,'requisicoes',rcEditId),payload,{merge:true});rcDoc={...anterior,...payload};}
    else{rcDoc={...payload,tipo:'RC',numero:await gerarNumReq('rc'),origemRM:null,data:hoje(),timestamp:new Date().toISOString()};await addDoc(collection(db,'requisicoes'),rcDoc);}
    window.closeRC();showToast(`📄 ${rcDoc.numero} finalizada`);await compartilharPDF(rcDoc);
  }catch(error){showToast(`⚠️ Erro: ${error.message}`);}
  finally{salvandoRC=false;btn.disabled=false;btn.textContent=label;}
}
window.salvarRC=salvarRC;

function verRC(id){
  const req=requisicoes.find(r=>r.docId===id);if(!req)return;
  document.getElementById('ver-title').textContent=req.numero;document.getElementById('ver-sub').textContent=(req.solicitante||'—')+(req.origemRM?` · origem ${req.origemRM}`:' · manual');
  const itens=(req.itens||[]).map(item=>`<div class="item-row req-detail"><div><strong>${escHtml(item.material)}</strong>${item.origem!=='manual'?`<small>${item.origem==='nao'?'Sem estoque':'Quantidade faltante'}</small>`:''}</div><span class="rc-qty">${item.qtd} ${escHtml(item.unid)}</span></div>`).join('');
  let actions='';
  if(req.status==='aberta')actions=`<button class="btn btn-g" style="margin-top:12px" onclick="closeVer();openFinalizarRC('${req.docId}')">✍️ Assinar e finalizar</button>`;
  else{
    actions=`${req.sigSolicitante?`<div class="sig-thumbs">${sigThumb('Solicitante',req.sigSolicitante)}</div>`:''}<button class="btn btn-b" style="margin-top:12px" onclick="baixarRCPDF('${req.docId}')">📄 Baixar / enviar PDF</button>`;
    actions+=req.status==='recebida'?`<div class="receipt-ok">📥 Recebido por ${escHtml(req.comprador||'—')}${req.notaFiscal?' · NF '+escHtml(req.notaFiscal):''}</div>`:`<button class="btn btn-g" style="margin-top:8px" onclick="closeVer();openRecebRC('${req.docId}')">📥 Lançar recebimento</button>`;
  }
  document.getElementById('ver-body').innerHTML=`<div class="req-detail-head">${reqStatusBadge(req.status)}${req.origemRM?`<p>Gerada automaticamente das faltas da ${escHtml(req.origemRM)}</p>`:''}</div>${itens}${actions}`;
  document.getElementById('modal-ver').classList.add('on');document.getElementById('mdl-ver').scrollTop=0;
}
window.verRC=verRC;

async function darkenSig(dataURL){
  if(!dataURL)return '';
  return new Promise(resolve=>{const img=new Image();img.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<pixels.data.length;i+=4){if(pixels.data[i+3]>10){pixels.data[i]=20;pixels.data[i+1]=24;pixels.data[i+2]=28;}}ctx.putImageData(pixels,0,0);resolve(canvas.toDataURL('image/png'));}catch{resolve(dataURL);}};img.onerror=()=>resolve(dataURL);img.src=dataURL;});
}
async function compartilharPDF(rc){
  if(!window.jspdf){showToast('⚠️ Biblioteca de PDF indisponível');return;}
  const {jsPDF}=window.jspdf;const pdf=new jsPDF({unit:'mm',format:'a4'});const W=210,M=16;let y=18;
  pdf.setFontSize(9);pdf.setTextColor(120);pdf.text('Sistema AMZP — Gestão Industrial',M,y);pdf.setFont(undefined,'bold');pdf.setFontSize(18);pdf.setTextColor(20);pdf.text('REQUISIÇÃO DE COMPRA',M,y+10);pdf.setFontSize(13);pdf.setTextColor(190,140,10);pdf.text(rc.numero,W-M,y+10,{align:'right'});y+=26;
  pdf.setFont(undefined,'normal');pdf.setFontSize(10);pdf.setTextColor(60);const dt=new Date(rc.timestamp||Date.now());pdf.text(`Solicitante: ${rc.solicitante||'-'}`,M,y);pdf.text(`Data: ${dt.toLocaleString('pt-BR')}`,W-M,y,{align:'right'});y+=6;pdf.text(`Setor: ${rc.setor||'-'}`,M,y);if(rc.origemRM)pdf.text(`Origem: ${rc.origemRM}`,W-M,y,{align:'right'});y+=10;
  pdf.setFillColor(238);pdf.rect(M,y-5,W-2*M,8,'F');pdf.setFont(undefined,'bold');pdf.setTextColor(40);pdf.text('ITEM',M+2,y);pdf.text('MATERIAL',M+14,y);pdf.text('UNID.',W-M-38,y);pdf.text('QTD',W-M-2,y,{align:'right'});y+=8;pdf.setFont(undefined,'normal');pdf.setTextColor(30);
  (rc.itens||[]).forEach((item,i)=>{if(y>265){pdf.addPage();y=20;}pdf.text(String(i+1),M+2,y);pdf.text(String(item.material||'').slice(0,55),M+14,y);pdf.text(String(item.unid||''),W-M-38,y);pdf.text(String(item.qtd),W-M-2,y,{align:'right'});pdf.setDrawColor(235);pdf.line(M,y+2.5,W-M,y+2.5);y+=8;});
  if(rc.obs){y+=4;pdf.setFontSize(9);pdf.setTextColor(90);pdf.text(`Obs: ${String(rc.obs).slice(0,100)}`,M,y);y+=8;}y+=16;
  const sig=await darkenSig(rc.sigSolicitante);if(sig){try{pdf.addImage(sig,'PNG',M,y-14,50,16);}catch{}}
  pdf.setDrawColor(140);pdf.line(M,y,M+62,y);pdf.setFontSize(9);pdf.text('Assinatura do solicitante',M,y+5);
  const blob=pdf.output('blob');const filename=`${String(rc.numero||'RC').replace(/[#\s]/g,'_')}.pdf`;const file=new File([blob],filename,{type:'application/pdf'});
  if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:rc.numero,text:`Requisição de compra ${rc.numero}`});return;}catch(error){if(error?.name==='AbortError')return;}}
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);showToast('📄 PDF baixado');
}
window.compartilharPDF=compartilharPDF;
window.baixarRCPDF=id=>{const rc=requisicoes.find(req=>req.docId===id);if(rc)compartilharPDF(rc);};

function openRecebRC(id){
  const req=requisicoes.find(r=>r.docId===id);if(!req)return;rcRecebId=id;
  document.getElementById('rcreceb-num').textContent=req.numero;document.getElementById('rcreceb-resumo').textContent=`${(req.itens||[]).length} ${(req.itens||[]).length===1?'item':'itens'}`;document.getElementById('rcreceb-data').textContent=new Date().toLocaleDateString('pt-BR');
  document.getElementById('rcreceb-comprador').value=req.comprador||'';document.getElementById('rcreceb-nf').value=req.notaFiscal||'';document.getElementById('rcreceb-obs').value=req.obsRecebimento||'';
  document.getElementById('modal-rcreceb').classList.add('on');document.getElementById('mdl-rcreceb').scrollTop=0;
}
window.openRecebRC=openRecebRC;window.closeRCreceb=()=>document.getElementById('modal-rcreceb').classList.remove('on');window.ovClickRCreceb=e=>{if(e.target.id==='modal-rcreceb')window.closeRCreceb();};
async function salvarRecebRC(){
  if(salvandoRCreceb)return;const comprador=document.getElementById('rcreceb-comprador').value.trim();if(!comprador){showToast('⚠️ Informe o responsável');return;}
  salvandoRCreceb=true;const btn=document.querySelector('#mdl-rcreceb .btn-g');const label=btn.textContent;btn.disabled=true;btn.textContent='⏳ Salvando...';
  try{const req=requisicoes.find(r=>r.docId===rcRecebId);await setDoc(doc(db,'requisicoes',rcRecebId),{comprador,notaFiscal:document.getElementById('rcreceb-nf').value.trim(),obsRecebimento:document.getElementById('rcreceb-obs').value.trim(),status:'recebida',timestampRecebimento:new Date().toISOString()},{merge:true});window.closeRCreceb();showToast(`✅ ${req.numero} recebida`);}catch(error){showToast(`⚠️ Erro: ${error.message}`);}finally{salvandoRCreceb=false;btn.disabled=false;btn.textContent=label;}
}
window.salvarRecebRC=salvarRecebRC;

function rReqDash(){
  const metrics=document.getElementById('d-req-metrics');if(!metrics)return;
  const reqs=filtrarPorPeriodo(requisicoes),rms=reqs.filter(r=>r.tipo==='RM'),rcs=reqs.filter(r=>r.tipo==='RC');
  const rmPend=rms.filter(r=>r.status!=='concluido').length,rmOk=rms.length-rmPend,rcAbertas=rcs.filter(r=>r.status==='aberta').length,rcEnviadas=rcs.filter(r=>r.status==='finalizada'||r.status==='enviada').length,rcRecebidas=rcs.filter(r=>r.status==='recebida').length;
  metrics.innerHTML=`<div class="mc"><div class="ml">RMs</div><div class="mv" style="color:var(--greentxt)">${rms.length}</div><div class="ms">${rmPend} em aberto</div></div><div class="mc"><div class="ml">RMs concluídas</div><div class="mv" style="color:var(--bluetxt)">${rmOk}</div><div class="ms">no período</div></div><div class="mc"><div class="ml">RCs de compra</div><div class="mv" style="color:var(--ambertxt)">${rcs.length}</div><div class="ms">${rcAbertas} para assinar</div></div><div class="mc"><div class="ml">RCs recebidas</div><div class="mv" style="color:var(--greentxt)">${rcRecebidas}</div><div class="ms">${rcEnviadas} enviadas</div></div>`;
  const barras=[['⏳ A assinar',rcAbertas,'var(--amber)'],['🛒 Enviadas',rcEnviadas,'var(--blue)'],['✅ Recebidas',rcRecebidas,'var(--green)']],total=rcs.length||1;
  document.getElementById('d-req-bars').innerHTML=`<div class="obar"><div class="chart-title">Status das compras (RC)</div>${barras.map(([label,value,color])=>`<div class="req-bar"><div><span>${label}</span><b>${value} / ${rcs.length}</b></div><i><span style="width:${pct(value,total)}%;background:${color}"></span></i></div>`).join('')}</div>`;
}
function updateReqBadge(){
  const badge=document.getElementById('req-badge');if(!badge)return;const pendentes=requisicoes.filter(r=>(r.tipo==='RM'&&r.status!=='concluido')||(r.tipo==='RC'&&r.status!=='recebida')).length;
  badge.hidden=pendentes===0;badge.textContent=pendentes>99?'99+':String(pendentes);
}
window.rReqDash=rReqDash;window.updateReqBadge=updateReqBadge;

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
  const volEnt=entFiltradas.filter(e=>classificacaoEntrega(e)!=='Devolução').reduce((s,e)=>s+(e.qtd||0),0);
  const semAss=entFiltradas.filter(e=>statusAssinaturaEntrega(e)==='Aguardando assinatura').length;
  const devs=entFiltradas.filter(e=>classificacaoEntrega(e)==='Devolução').length;
  const parc=entFiltradas.filter(e=>classificacaoEntrega(e)==='Parcial').length;
  const compl=entFiltradas.filter(e=>classificacaoEntrega(e)==='Concluída').length;
  const totEnt=entFiltradas.length;
  document.getElementById('d-ent-metrics').innerHTML=`
    <div class="mc"><div class="ml">Entregas</div><div class="mv" style="color:var(--greentxt)">${entHoje}</div><div class="ms">no período</div></div>
    <div class="mc"><div class="ml">Volume entregue</div><div class="mv" style="color:var(--bluetxt)">${volEnt.toLocaleString('pt-BR')}</div><div class="ms">unidades</div></div>
    <div class="mc"><div class="ml">Sem assinatura</div><div class="mv" style="color:var(--redtxt)">${semAss}</div><div class="ms">pendentes</div></div>
    <div class="mc"><div class="ml">Devoluções</div><div class="mv" style="color:var(--ambertxt)">${devs}</div><div class="ms">no período</div></div>`;
  const entBars=[{l:'✅ Completas',v:compl,c:'var(--green)'},{l:'⚠️ Parciais',v:parc,c:'var(--amber)'},{l:'↩️ Devoluções',v:devs,c:'var(--red)'}];
  document.getElementById('d-ent-bars').innerHTML=`<div class="obar"><div style="font-size:10px;color:var(--text2);margin-bottom:8px;font-weight:600">Status das entregas</div>${entBars.map(b=>`<div style="margin-bottom:7px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span style="color:var(--text2)">${b.l}</span><span style="font-family:var(--mono);color:var(--text)">${b.v} / ${totEnt||1}</span></div><div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden"><div style="width:${pct(b.v,totEnt||1)}%;height:100%;background:${b.c}"></div></div></div>`).join('')}</div>`;

  const totalEnt=entregas.filter(e=>classificacaoEntrega(e)!=='Devolução').reduce((s,e)=>s+(e.qtd||0),0);
  const estoque=totProd-totalEnt;
  document.getElementById('d-comparativo').innerHTML=`<div class="obar">
    <div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px"><span style="color:var(--text2)">📦 Total pedido</span><span style="font-family:var(--mono);font-weight:600;color:var(--text)">${totP.toLocaleString('pt-BR')} un</span></div><div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:100%;height:100%;background:var(--border2)"></div></div></div>
    <div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px"><span style="color:var(--greentxt)">⚙️ Produzido</span><span style="font-family:var(--mono);font-weight:600;color:var(--greentxt)">${totProd.toLocaleString('pt-BR')} un · ${pct(totProd,totP)}%</span></div><div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${pct(totProd,totP)}%;height:100%;background:var(--green)"></div></div></div>
    <div><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px"><span style="color:var(--bluetxt)">🚚 Entregue</span><span style="font-family:var(--mono);font-weight:600;color:var(--bluetxt)">${totalEnt.toLocaleString('pt-BR')} un · ${pct(totalEnt,totP)}%</span></div><div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${pct(totalEnt,totP)}%;height:100%;background:var(--blue)"></div></div></div>
    <div class="gap-card"><span style="font-size:11px;color:var(--purple)">📊 Em estoque (produzido não entregue)</span><span style="font-size:12px;font-weight:700;color:var(--purple);font-family:var(--mono)">${Math.max(0,estoque).toLocaleString('pt-BR')} un</span></div>
  </div>`;

  rReqDash();

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
    <div class="aba-item"><span class="aba-icon">🚚</span><div class="aba-info"><div class="aba-name">Entregas</div><div class="aba-desc">Romaneios e saídas</div></div><span class="aba-badge">${entregas.length} linhas</span></div>
    <div class="aba-item"><span class="aba-icon">🧾</span><div class="aba-info"><div class="aba-name">Requisições</div><div class="aba-desc">RM e RC com status e itens</div></div><span class="aba-badge">${requisicoes.length} linhas</span></div>`;
}
window.exportarCSV=function(){
  const h1=['Nº OP','Produto','Cliente','Qtd Pedida','Unid','Data Pedido','Prazo','Qtd Produzida','Qtd Entregue','% Concluído','Status'];
  const r1=pedidos.map(p=>{
    const s=calcStatus(p);const pr=p.qtdPedida?Math.round(p.qtdProduzida/p.qtdPedida*100):0;
    return[p.id,p.produto,p.cliente,p.qtdPedida,p.unid,p.dataPedido,p.prazoEntrega,p.qtdProduzida,qtdEntregue(p.id),pr+'%',s].join(';');
  });
  const h2=['Data/Hora','Nº OP','Produto','Cliente','Turno','Operador','Qtd','Unid','Observações'];
  const r2=apontamentos.map(a=>[new Date(a.timestamp).toLocaleString('pt-BR'),a.pedidoId,a.produto,a.cliente,a.turno,a.operador,a.qtd,a.unid,(a.obs||'').replace(/;/g,',')].join(';'));
  const h3=['Romaneio','Data','Nº OP','Cliente','Produto','Qtd','Unid','Entregador','Conferente','Veículo','Destino','Classificação','Status assinatura','Estoque antes saída','Estoque depois saída','Obs'];
  const r3=entregas.map(e=>[e.romaneio,new Date(e.timestamp).toLocaleString('pt-BR'),e.pedidoId,e.cliente,e.produto,e.qtd,e.unid,e.entregador,e.conferente,e.veiculo,e.destino,classificacaoEntrega(e),statusAssinaturaEntrega(e),fmtQtd(qtdEmEmpresaAntesEntrega(e),e.unid),fmtQtd(qtdEmEmpresaDepoisEntrega(e),e.unid),(e.obs||'').replace(/;/g,',')].join(';'));
  const h4=['Tipo','Número','Data/Hora','Solicitante','Setor','Status','Origem RM','Itens','Observação'];
  const r4=requisicoes.map(r=>[r.tipo,r.numero,new Date(r.timestamp).toLocaleString('pt-BR'),r.solicitante,r.setor,reqStatusLabel(r.status),r.origemRM||'',(r.itens||[]).map(i=>`${i.material} (${i.qtd} ${i.unid})`).join(' | '),(r.obs||'').replace(/;/g,',')].map(csvCell).join(';'));
  const csv='\uFEFF'+'=== PEDIDOS ===\n'+[h1.join(';'),...r1].join('\n')+'\n\n=== APONTAMENTOS ===\n'+[h2.join(';'),...r2].join('\n')+'\n\n=== ENTREGAS ===\n'+[h3.join(';'),...r3].join('\n')+'\n\n=== REQUISIÇÕES ===\n'+[h4.join(';'),...r4].join('\n');
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
iniciarSyncReq();
setInterval(updateTopbar,30000);

// Esconde splash quando carregar
setTimeout(()=>{
  const splash = document.getElementById('splash');
  if(splash){
    splash.style.opacity='0';
    setTimeout(()=>splash.remove(),400);
  }
}, 1400);
