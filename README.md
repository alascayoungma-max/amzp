# Sistema AMZP — Gestão Industrial

Aplicativo mobile para controle de produção, entregas e dashboard executivo com sincronização em tempo real via Firebase.

## Estrutura do Projeto

```
amzp/
├── index.html          # Página principal
├── css/
│   └── style.css       # Estilos
├── js/
│   ├── firebase.js     # Configuração do Firebase
│   └── app.js          # Lógica do aplicativo
└── README.md
```

## Funcionalidades

- 📋 **Pedidos** — Cadastro com múltiplos produtos por pedido
- 📝 **Apontamentos** — Registro de produção por turno e operador
- 🚚 **Entregas** — Romaneio automático, assinatura digital e foto
- 🧾 **RM / RC** — Requisição de material, conferência do almoxarifado e compras
- ✍️ **Fluxo de aprovação** — Assinaturas na solicitação, liberação e retirada
- 📄 **PDF de compra** — Geração e compartilhamento da requisição de compra
- 📊 **Dashboard** — Resumo de produção e entregas em tempo real
- ⬇️ **Exportar** — Geração de CSV compatível com Excel

## Tecnologias

- HTML5 + CSS3 + JavaScript (módulos ES6)
- Firebase Firestore (banco de dados em tempo real)
- Cache local persistente para operação com conexão instável
- Hospedagem: GitHub Pages

## Acesso

Disponível em: **alascayoungma-max.github.io/amzp**
