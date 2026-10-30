# Segurança

## Como o projeto trata dados sensíveis

- Roda **só no computador do usuário**, escutando em `127.0.0.1` (nunca na rede).
- Não guarda senhas. O login da conta Claude fica na pasta do Claude Code do próprio usuário; uma chave de API, se colada, fica em `chave_api.txt`, que está no `.gitignore`.
- O painel não tem autenticação própria: **não exponha a porta 8765 na internet** nem em redes compartilhadas (não troque o `host` de `127.0.0.1` para `0.0.0.0` em `servidor.py` e não use túneis públicos).

## Reportar uma vulnerabilidade

Use o relato privado do GitHub: aba **Security → Report a vulnerability** deste repositório. Se não estiver disponível, abra uma *issue* só dizendo que há um problema de segurança, sem detalhes, e aguarde contato.

Pedimos um prazo razoável para corrigir antes de qualquer divulgação pública.

## Se você vazou uma chave por engano

Apagar o arquivo não basta: o histórico do Git guarda o conteúdo. **Revogue a chave** (console.anthropic.com para chave de API; github.com/settings/applications para tokens do GitHub) e gere outra.
