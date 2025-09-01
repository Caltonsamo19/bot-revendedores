# 🔍 Configuração do Google Vision API

## 📋 **Funcionalidades Implementadas**

✅ **Método Híbrido**: Google Vision OCR + GPT-4 interpretação  
✅ **Fallback automático**: Se Google Vision falhar, usa GPT-4 Vision  
✅ **Sistema redundante**: Garantia de que imagens sempre serão processadas  
✅ **Logs detalhados**: Para debugging e monitoramento  
✅ **Comando de teste**: `.test_vision` para verificar status  

## 🚀 **Como Configurar**

### **Opção 1: Arquivo de Credenciais JSON (Recomendado)**

1. **Criar projeto no Google Cloud:**
   - Acesse [Google Cloud Console](https://console.cloud.google.com)
   - Crie um novo projeto ou selecione existente
   - Ative a **Vision API**

2. **Criar Service Account:**
   - Vá em IAM & Admin > Service Accounts
   - Clique em "Create Service Account"
   - Dê um nome (ex: "whatsapp-bot-vision")
   - Role: "Vision AI" > "AutoML Vision Admin" ou "Editor"

3. **Baixar chave JSON:**
   - Clique na service account criada
   - Aba "Keys" > "Add Key" > "Create New Key"
   - Tipo: JSON
   - Salve como `google-vision-credentials.json` na pasta do bot

4. **Configurar .env:**
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=./google-vision-credentials.json
   GOOGLE_VISION_ENABLED=true
   GOOGLE_VISION_TIMEOUT=10000
   ```

### **Opção 2: API Key Direta (Para Teste)**

1. **Gerar API Key:**
   - Google Cloud Console > APIs & Services > Credentials
   - "Create Credentials" > "API Key"
   - Copie a chave gerada

2. **Configurar .env:**
   ```bash
   GOOGLE_VISION_API_KEY=sua_api_key_aqui
   GOOGLE_VISION_ENABLED=true
   GOOGLE_VISION_TIMEOUT=10000
   ```

## 📦 **Instalar Dependências**

```bash
npm install @google-cloud/vision
```

## 🧪 **Testar a Configuração**

1. **Verificar status:**
   ```
   .test_vision
   ```

2. **Testar com imagem real:**
   - Envie uma imagem de comprovante M-Pesa/E-Mola
   - Verifique nos logs qual método foi usado:
     - `🚀 Tentando método híbrido` = Google Vision ativo
     - `🧠 Usando GPT-4 Vision` = Fallback ou Vision desabilitado

## 📊 **Vantagens do Método Híbrido**

| Aspecto | Google Vision + GPT-4 | GPT-4 Vision Apenas |
|---------|----------------------|-------------------|
| **Precisão OCR** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Velocidade** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Custo** | ⭐⭐⭐⭐ | ⭐⭐ |
| **Confiabilidade** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

## 🔧 **Troubleshooting**

### **Google Vision não funciona:**
- ✅ Verifique se as credenciais estão corretas
- ✅ Confirme que a Vision API está habilitada no projeto
- ✅ Verifique permissões da Service Account
- ✅ Teste conectividade com a internet

### **Fallback para GPT-4 Vision:**
- ⚠️ Normal em caso de erro temporário
- ⚠️ Verifique logs para ver o motivo
- ⚠️ Bot continua funcionando normalmente

## 📈 **Logs de Monitoramento**

```bash
# Google Vision ativo
🔍 Google Vision inicializado com arquivo de credenciais
🚀 Tentando método híbrido (Google Vision + GPT-4)...
✅ Google Vision extraiu 150 caracteres
✅ Método híbrido bem-sucedido!

# Fallback ativo
⚠️ Método híbrido falhou: timeout
🔄 Tentando fallback com GPT-4 Vision...
🧠 Usando GPT-4 Vision como fallback
```

## 🎯 **Resultado Final**

O bot agora possui:
- **Maior precisão** na leitura de comprovantes
- **Menor custo** operacional
- **Sistema redundante** (nunca falha)
- **Todas as funcionalidades originais** preservadas
- **Logs detalhados** para monitoramento

**💡 Se Google Vision não for configurado, o bot continua funcionando normalmente com GPT-4 Vision!**