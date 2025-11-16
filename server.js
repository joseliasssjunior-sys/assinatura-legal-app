const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json({ limit: "15mb" }));

// ---------------------------------------------
// CONFIGURAÇÃO DE SEGURANÇA
// ---------------------------------------------
const EMAIL_USER = process.env.EMAIL_USER || "seu-email-aqui@gmail.com";
const EMAIL_PASS = process.env.EMAIL_PASS || "sua-senha-de-app-aqui";

const REGISTROS_PATH = path.join(__dirname, "assinaturas.json");

// ---------------------------------------------
// Funções de Registro (Banco de Dados JSON)
// ---------------------------------------------
function carregarRegistros() {
    try {
        if (!fs.existsSync(REGISTROS_PATH)) {
            salvarRegistros([]); 
            return [];
        }
        const conteudo = fs.readFileSync(REGISTROS_PATH, "utf8");
        return JSON.parse(conteudo);
    } catch (err) {
        console.error("Erro ao carregar registros:", err);
        return [];
    }
}
function salvarRegistros(registros) {
    try {
        fs.writeFileSync(REGISTROS_PATH, JSON.stringify(registros, null, 2), "utf8");
    } catch (err) {
        console.error("Erro ao salvar registros:", err);
    }
}
function registrarAssinatura({ idAssinatura, hash, nomeCliente, emailCliente, dataHora, extra }) {
    const registros = carregarRegistros();
    const registro = {
        idAssinatura: idAssinatura || null,
        hash, nomeCliente, emailCliente: emailCliente || null, dataHora,
        criadoEm: new Date().toISOString(),
        ...extra
    };
    registros.push(registro);
    salvarRegistros(registros);
    return registro;
}

// ---------------------------------------------
// ### CORREÇÃO V1.3 - Configura transportador de e-mail ###
// ---------------------------------------------
// Em vez de "service: 'gmail'", vamos ser explícitos
// para evitar o "ETIMEDOUT" (Timeout) do Render.
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",     // O "endereço" exato do Gmail
    port: 465,                  // A "porta" segura (SSL)
    secure: true,               // Obrigatório usar SSL/TLS
    auth: {
        user: EMAIL_USER,       // (Lido do process.env)
        pass: EMAIL_PASS        // (Lido do process.env)
    }
});

// ---------------------------------------------
// Rota para "servir" (mostrar) os arquivos HTML
// ---------------------------------------------
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "procuracao_assinatura.html"));
});
app.get("/validar", (req, res) => {
    res.sendFile(path.join(__dirname, "validar.html"));
});


// ---------------------------------------------
// Rota que envia o PDF por e-mail E REGISTRA
// ---------------------------------------------
app.post("/enviar-email", async (req, res) => {
    try {
        const {
            pdfBase64, nomeCliente, emailCliente, hash, dataHora, geo,
            cpfCliente, docIdCliente, enderecoCliente, idAssinatura,
            nacionalidade, estadoCivil, profissao
        } = req.body;

        if (!pdfBase64 || !nomeCliente || !hash || !dataHora) {
            return res.status(400).json({ ok: false, error: "Dados obrigatórios faltando." });
        }

        const pdfBuffer = Buffer.from(pdfBase64, "base64");
        const destinatarios = [EMAIL_USER];
        if (emailCliente) destinatarios.push(emailCliente);

        const assunto = idAssinatura
            ? `Documento assinado - ${nomeCliente} - ${idAssinatura}`
            : `Documento assinado - ${nomeCliente}`;

        const corpoTexto =
`Documento assinado eletronicamente.
Dados principais:
- ID da assinatura: ${idAssinatura || "não informado"}
- Nome: ${nomeCliente}
- CPF: ${cpfCliente || "não informado"}
- Endereço: ${enderecoCliente || "não informado"}
- Doc. identidade: ${docIdCliente || "não informado"}
- E-mail do cliente: ${emailCliente || "não informado"}
- Data/hora: ${dataHora}
- Hash SHA-256: ${hash}
`;

        // O "await" aqui é onde o erro de ETIMEDOUT aconteceu
        const info = await transporter.sendMail({
            from: `"Assinatura Digital" <${EMAIL_USER}>`,
            to: destinatarios.join(", "),
            subject: assunto,
            text: corpoTexto,
            attachments: [
                {
                    filename: "documento_assinado.pdf",
                    content: pdfBuffer
                }
            ]
        });

        const registro = registrarAssinatura({
            idAssinatura, hash, nomeCliente, emailCliente, dataHora,
            extra: {
                cpfCliente: cpfCliente || null,
                docIdCliente: docIdCliente || null,
                enderecoCliente: enderecoCliente || null,
                nacionalidade: nacionalidade || null,
                estadoCivil: estadoCivil || null,
                profissao: profissao || null,
                geo: geo || null,
                messageIdEmail: info.messageId
            }
        });

        res.json({ ok: true, messageId: info.messageId, registroSalvo: registro });

    } catch (err) {
        // Agora, se der erro de novo, vamos ver no log
        console.error("!!! ERRO NO /enviar-email !!!:", err);
        res.status(500).json({ ok: false, error: "Erro ao enviar ou registrar assinatura." });
    }
});

// ---------------------------------------------
// ROTA DE TESTE DE E-MAIL (SEM PDF)
// ---------------------------------------------
app.get("/teste-email", async (req, res) => {
    try {
        const info = await transporter.sendMail({
            from: `"Teste Assinatura" <${EMAIL_USER}>`,
            to: EMAIL_USER,
            subject: "Teste de envio de e-mail (sem PDF)",
            text: "Se você recebeu este e-mail, o servidor está autorizado a enviar e-mails pelo Gmail."
        });
        console.log("E-mail de teste enviado:", info.messageId);
        res.send("E-mail de teste enviado com sucesso! Veja sua caixa de entrada.");
    } catch (err) {
        console.error("Erro ao enviar e-mail de teste:", err);
        res.status(500).send("Erro ao enviar e-mail de teste. Veja o console do servidor.");
    }
});

// ---------------------------------------------
// ROTA DE VALIDAÇÃO POR ID OU HASH
// ---------------------------------------------
app.get("/validar/:chave", (req, res) => {
    const chave = req.params.chave;
    const registros = carregarRegistros();

    const registro = registros.find(r =>
        r.idAssinatura === chave || r.hash === chave
    );

    if (!registro) {
        return res.status(4404).json({
            ok: false,
            mensagem: "Assinatura não encontrada para este ID ou hash."
        });
    }

    return res.json({
        ok: true,
        registro
    });
});

// ---------------------------------------------
// Ligar o Servidor
// ---------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
