# Controle de Disponibilidade para Atendimento

Aplicativo web para que técnicos atualizem sua disponibilidade e a recepção acompanhe o status de todos em tempo real.

## Requisitos

- Windows
- Node.js 22.13 ou superior instalado e disponível no PATH (`node` no Prompt de Comando ou PowerShell)
- Não é necessário instalar dependências adicionais

## Iniciar

1. Execute `iniciar.bat`.
2. Aguarde a mensagem de que o servidor está em `http://localhost:3000`.
3. Abra [http://localhost:3000](http://localhost:3000) no navegador.

Para encerrar, feche a janela do servidor ou pressione `Ctrl+C` nela.

## Acesso

- **Recepção:** login `recepcao`, senha inicial `123`. A tela fica em `/recepcao` e lista os técnicos cadastrados, com atualização periódica.
- **Técnico:** use `/cadastro` para informar nome e senha. O nome será usado como login; após o cadastro, o técnico entra automaticamente e pode alternar seu próprio status.
- **Login:** `/login`. A sessão expira após 12 horas; use o botão **Sair** para encerrá-la antes.

O nome deve ter entre 2 e 40 caracteres e ser exclusivo. A senha deve ter pelo menos 4 caracteres.

## Acesso pela rede local

Para outros dispositivos da mesma rede, obtenha o endereço IP local do computador que está executando o servidor e abra `http://IP-DO-COMPUTADOR:3000` no dispositivo. O computador precisa permanecer ligado com o servidor aberto. Se não conectar, verifique se o firewall do Windows permite conexões de entrada na porta 3000.

## Dados e permissões

- `atendimento.sqlite` é o banco SQLite usado para armazenar usuários, hashes de senhas e disponibilidade.
- Se `usuarios.json` ou `estado.json` existir, seus registros são importados para o SQLite na inicialização. O processo não apaga nem altera esses arquivos.
- Faça cópia de segurança de `atendimento.sqlite` para preservar os dados. Para transferir o aplicativo, copie esse arquivo junto com o projeto.
- Cada técnico só pode consultar e alterar seu próprio status. A recepção pode consultar a lista completa.
- O cadastro de técnicos é aberto para quem acessar `/cadastro`.

## Observação de segurança

O servidor usa HTTP sem criptografia. Use somente em uma rede confiável; não exponha diretamente à internet. Como o cadastro é aberto, qualquer pessoa com acesso ao endereço pode criar um usuário técnico.
