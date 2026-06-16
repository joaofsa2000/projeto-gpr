const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const porta = 3000;

// ==========================================
// 1. CONFIGURAÇÃO DA BASE DE DADOS
// ==========================================
const db = new sqlite3.Database(path.join(__dirname, 'servidor.db'), (err) => {
    if (err) console.error('Erro ao ligar ao SQLite:', err.message);
    else {
        console.log('Ligação ao SQLite estabelecida com sucesso.');
        db.run("PRAGMA foreign_keys = ON"); // Ativar chaves estrangeiras
        db.run("PRAGMA journal_mode = WAL;"); // Permite leituras e escritas em simultâneo
        db.run("PRAGMA synchronous = NORMAL;"); // Reduz as vezes que o SQLite obriga o SD a gravar fisicamente
        db.run("PRAGMA temp_store = MEMORY;"); // Guarda ficheiros temporários na RAM do Pi em vez do SD
    }
});

// Criar Tabelas
db.serialize(() => {
    // Tabela de Logs do Sistema
    db.run(`CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT, metodo TEXT, url TEXT, status INTEGER, latencia_ms REAL, ip TEXT
    )`);

    // Tabela de Veículos
    db.run(`CREATE TABLE IF NOT EXISTS veiculos (
        matricula TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        quilometros_iniciais REAL NOT NULL,
        tipo_combustivel TEXT NOT NULL,
        tipo_veiculo TEXT NOT NULL,
        data_registo TEXT
    )`);

    // Tabela de Viagens (Abastecimentos)
    db.run(`CREATE TABLE IF NOT EXISTS viagens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        veiculo_matricula TEXT NOT NULL,
        quilometros_totais REAL NOT NULL,
        distancia_viagem REAL NOT NULL,
        tipo_abastecimento TEXT NOT NULL,
        litros REAL NOT NULL,
        valor_euros REAL NOT NULL,
        data_hora TEXT NOT NULL,
        descricao TEXT,
        FOREIGN KEY (veiculo_matricula) REFERENCES veiculos(matricula)
    )`);
});

const dbGet = (sql, params) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

// ==========================================
// 2. MIDDLEWARES
// ==========================================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Servir ficheiros estáticos da SPA

// Ignorar pedidos ao favicon do browser
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Middleware de Logging e Latência
app.use((req, res, next) => {
    const inicio = process.hrtime();
    res.on('finish', () => {
        const diferenca = process.hrtime(inicio);
        const latenciaMs = parseFloat((diferenca[0] * 1e3 + diferenca[1] * 1e-6).toFixed(3));
        const timestamp = new Date().toISOString();

        const stmt = db.prepare(`INSERT INTO logs (timestamp, metodo, url, status, latencia_ms, ip) VALUES (?, ?, ?, ?, ?, ?)`);
        stmt.run(timestamp, req.method, req.originalUrl, res.statusCode, latenciaMs, req.ip);
        stmt.finalize();

        console.log(JSON.stringify({ timestamp, metodo: req.method, url: req.originalUrl, status: res.statusCode, latencia_ms: latenciaMs }));
    });
    next();
});

// ==========================================
// 3. ROTAS DE VEÍCULOS
// ==========================================

// Criar um novo veículo
app.post('/veiculos', (req, res) => {
    const { matricula, nome, quilometros_iniciais, tipo_combustivel, tipo_veiculo } = req.body;

    if (!matricula || !nome || quilometros_iniciais === undefined) {
        return res.status(400).json({ erro: 'Matrícula, nome e quilómetros iniciais são obrigatórios.' });
    }

    const dataRegisto = new Date().toISOString();
    const stmt = db.prepare(`INSERT INTO veiculos (matricula, nome, quilometros_iniciais, tipo_combustivel, tipo_veiculo, data_registo) VALUES (?, ?, ?, ?, ?, ?)`);

    stmt.run(matricula, nome, quilometros_iniciais, tipo_combustivel, tipo_veiculo, dataRegisto, function (err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ erro: 'Já existe um veículo registado com esta matrícula.' });
            }
            return res.status(500).json({ erro: 'Falha ao criar o veículo.' });
        }
        res.status(201).json({ mensagem: 'Veículo registado com sucesso!', matricula });
    });
    stmt.finalize();
});

// Listar todos os veículos com kms atuais
app.get('/veiculos', (req, res) => {
    const sql = `
        SELECT 
            v.*,
            COALESCE(
                (SELECT MAX(quilometros_totais) FROM viagens WHERE veiculo_matricula = v.matricula),
                v.quilometros_iniciais
            ) as quilometros_atuais
        FROM veiculos v
        ORDER BY v.data_registo DESC
    `;
    db.all(sql, [], (err, linhas) => {
        if (err) return res.status(500).json({ erro: 'Falha ao obter os veículos.' });
        res.status(200).json({ total: linhas.length, veiculos: linhas });
    });
});

// Obter um veículo específico pela matrícula
app.get('/veiculos/:matricula', async (req, res) => {
    const matricula = req.params.matricula.toUpperCase();
    try {
        const veiculo = await dbGet('SELECT * FROM veiculos WHERE UPPER(matricula) = ?', [matricula]);
        if (!veiculo) return res.status(404).json({ erro: 'Veículo não encontrado.' });
        res.status(200).json(veiculo);
    } catch (err) {
        res.status(500).json({ erro: 'Falha ao procurar o veículo.' });
    }
});

// Atualizar um veículo existente
app.put('/veiculos/:matricula', async (req, res) => {
    const matricula = req.params.matricula.toUpperCase();
    const { nome, tipo_combustivel, tipo_veiculo } = req.body;
    if (!nome || !tipo_combustivel || !tipo_veiculo) return res.status(400).json({ erro: 'Faltam dados obrigatórios.' });

    const stmt = db.prepare(`UPDATE veiculos SET nome = ?, tipo_combustivel = ?, tipo_veiculo = ? WHERE UPPER(matricula) = ?`);
    stmt.run(nome, tipo_combustivel, tipo_veiculo, matricula, function(err) {
        if (err) return res.status(500).json({ erro: 'Falha ao atualizar o veículo.' });
        if (this.changes === 0) return res.status(404).json({ erro: 'Veículo não encontrado.' });
        res.status(200).json({ mensagem: 'Veículo atualizado com sucesso!' });
    });
    stmt.finalize();
});

// ==========================================
// 4. ROTAS DE VIAGENS / ABASTECIMENTOS
// ==========================================

// Adicionar um novo registo de viagem/abastecimento
app.post('/veiculos/:matricula/viagens', async (req, res) => {
    const matricula = req.params.matricula.toUpperCase();
    const { quilometros_totais, tipo_abastecimento, litros, valor_euros, descricao } = req.body;
    const dataHora = req.body.data_hora || new Date().toISOString();

    if (!quilometros_totais || !tipo_abastecimento || !litros || !valor_euros) {
        return res.status(400).json({ erro: 'Faltam campos obrigatórios para registar a viagem.' });
    }

    try {
        const veiculo = await dbGet('SELECT quilometros_iniciais FROM veiculos WHERE UPPER(matricula) = ?', [matricula]);
        if (!veiculo) return res.status(404).json({ erro: 'Veículo não encontrado.' });

        const ultimoRegisto = await dbGet('SELECT MAX(quilometros_totais) as ultimos_km FROM viagens WHERE UPPER(veiculo_matricula) = ?', [matricula]);

        const quilometrosAnteriores = ultimoRegisto && ultimoRegisto.ultimos_km !== null ? ultimoRegisto.ultimos_km : veiculo.quilometros_iniciais;
        const distanciaViagem = parseFloat((quilometros_totais - quilometrosAnteriores).toFixed(2));

        if (distanciaViagem < 0) {
            return res.status(400).json({ erro: `Os quilómetros totais (${quilometros_totais}) não podem ser inferiores ao último registo (${quilometrosAnteriores}).` });
        }

        const stmt = db.prepare(`INSERT INTO viagens (veiculo_matricula, quilometros_totais, distancia_viagem, tipo_abastecimento, litros, valor_euros, data_hora, descricao) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

        stmt.run(matricula, quilometros_totais, distanciaViagem, tipo_abastecimento, litros, valor_euros, dataHora, descricao || null, function (err) {
            if (err) return res.status(500).json({ erro: 'Falha ao guardar a viagem.' });

            res.status(201).json({
                mensagem: 'Viagem registada com sucesso.',
                id_registo: this.lastID,
                veiculo: matricula,
                distancia_viagem_calculada: distanciaViagem
            });
        });
        stmt.finalize();

    } catch (err) {
        res.status(500).json({ erro: 'Erro no servidor ao processar a viagem.' });
    }
});

// Obter histórico de viagens com cálculos de consumo (L/100km) e custo (€/km)
app.get('/veiculos/:matricula/viagens', (req, res) => {
    const matricula = req.params.matricula.toUpperCase();

    db.all('SELECT * FROM viagens WHERE UPPER(veiculo_matricula) = ? ORDER BY quilometros_totais DESC', [matricula], (err, linhas) => {
        if (err) return res.status(500).json({ erro: 'Falha ao obter o histórico de viagens.' });

        const historicoComMetricas = linhas.map(viagem => {
            let consumo = null;
            let custoPorKm = null;

            if (viagem.distancia_viagem > 0) {
                consumo = parseFloat(((viagem.litros / viagem.distancia_viagem) * 100).toFixed(2));
                custoPorKm = parseFloat((viagem.valor_euros / viagem.distancia_viagem).toFixed(3));
            }

            return {
                ...viagem,
                consumo_l_100km: consumo,
                custo_por_km_euros: custoPorKm
            };
        });

        res.status(200).json({ total_registos: linhas.length, historico: historicoComMetricas });
    });
});

// Atualizar um registo de viagem/abastecimento (apenas dados não-quilométricos)
app.put('/viagens/:id', (req, res) => {
    const id = req.params.id;
    const { litros, valor_euros, tipo_abastecimento, descricao } = req.body;

    if (!litros || !valor_euros || !tipo_abastecimento) {
        return res.status(400).json({ erro: 'Litros, valor e tipo são obrigatórios.' });
    }

    const stmt = db.prepare(`UPDATE viagens SET litros = ?, valor_euros = ?, tipo_abastecimento = ?, descricao = ? WHERE id = ?`);
    stmt.run(litros, valor_euros, tipo_abastecimento, descricao || null, id, function(err) {
        if (err) return res.status(500).json({ erro: 'Falha ao atualizar a viagem.' });
        if (this.changes === 0) return res.status(404).json({ erro: 'Viagem não encontrada.' });
        res.status(200).json({ mensagem: 'Viagem atualizada com sucesso!' });
    });
    stmt.finalize();
});

// Estatísticas detalhadas do veículo (APM style: 30 days vs prev 30 days, cronologia)
app.get('/veiculos/:matricula/estatisticas', async (req, res) => {
    const matricula = req.params.matricula.toUpperCase();
    
    try {
        const veiculo = await dbGet('SELECT * FROM veiculos WHERE UPPER(matricula) = ?', [matricula]);
        if (!veiculo) return res.status(404).json({ erro: 'Veículo não encontrado.' });

        const sqlViagens = `SELECT * FROM viagens WHERE UPPER(veiculo_matricula) = ? ORDER BY data_hora ASC`;
        db.all(sqlViagens, [matricula], (err, viagens) => {
            if (err) return res.status(500).json({ erro: 'Falha ao obter viagens para estatísticas.' });

            const agora = new Date();
            const trintaDiasAtras = new Date(agora.getTime() - (30 * 24 * 60 * 60 * 1000));
            const sessentaDiasAtras = new Date(agora.getTime() - (60 * 24 * 60 * 60 * 1000));
            const noventaDiasAtras = new Date(agora.getTime() - (90 * 24 * 60 * 60 * 1000));

            let current30 = { distancia: 0, custo: 0, litros: 0 };
            let prev30 = { distancia: 0, custo: 0, litros: 0 };
            let last90 = { distancia: 0, custo: 0 };
            let allTime = { distancia: 0, custo: 0, litros: 0 };
            let cronologia = [];

            viagens.forEach(v => {
                const dataV = new Date(v.data_hora);
                let consumo = null;
                let custo_km = null;

                if (v.distancia_viagem > 0) {
                    consumo = parseFloat(((v.litros / v.distancia_viagem) * 100).toFixed(2));
                    custo_km = parseFloat((v.valor_euros / v.distancia_viagem).toFixed(3));
                }

                cronologia.push({
                    data: v.data_hora,
                    distancia: v.distancia_viagem,
                    consumo_l_100km: consumo,
                    custo_por_km: custo_km,
                    custo_total: v.valor_euros
                });

                allTime.distancia += v.distancia_viagem;
                allTime.custo += v.valor_euros;
                allTime.litros += v.litros;

                if (dataV >= trintaDiasAtras && dataV <= agora) {
                    current30.distancia += v.distancia_viagem;
                    current30.custo += v.valor_euros;
                    current30.litros += v.litros;
                } else if (dataV >= sessentaDiasAtras && dataV < trintaDiasAtras) {
                    prev30.distancia += v.distancia_viagem;
                    prev30.custo += v.valor_euros;
                    prev30.litros += v.litros;
                }

                if (dataV >= noventaDiasAtras && dataV <= agora) {
                    last90.distancia += v.distancia_viagem;
                    last90.custo += v.valor_euros;
                }
            });

            const calcMedia = (dist, litros) => dist > 0 ? (litros / dist) * 100 : 0;
            const currentMedia = calcMedia(current30.distancia, current30.litros);
            const prevMedia = calcMedia(prev30.distancia, prev30.litros);
            const allTimeMedia = calcMedia(allTime.distancia, allTime.litros);

            const calcVariacao = (atual, anterior) => {
                if (anterior === 0) return atual > 0 ? 100 : 0;
                return ((atual - anterior) / anterior) * 100;
            };

            const kmAtuais = viagens.length > 0 ? Math.max(...viagens.map(v => v.quilometros_totais)) : veiculo.quilometros_iniciais;

            let diasDecorridos = 90;
            if (viagens.length > 0) {
                const primeiraViagem = new Date(viagens[0].data_hora);
                const diasTotais = (agora.getTime() - primeiraViagem.getTime()) / (1000 * 3600 * 24);
                if (diasTotais < 90) diasDecorridos = Math.max(1, diasTotais);
            }
            const diariaDistancia = last90.distancia / diasDecorridos;
            const diariaCusto = last90.custo / diasDecorridos;

            res.status(200).json({
                veiculo: veiculo.nome,
                tipo_combustivel: veiculo.tipo_combustivel,
                quilometros_atuais: kmAtuais,
                kpis: {
                    ultimos_30_dias: {
                        distancia_km: parseFloat(current30.distancia.toFixed(2)),
                        custo_euros: parseFloat(current30.custo.toFixed(2)),
                        consumo_medio: parseFloat(currentMedia.toFixed(2))
                    },
                    todo_o_tempo: {
                        distancia_km: parseFloat(allTime.distancia.toFixed(2)),
                        custo_euros: parseFloat(allTime.custo.toFixed(2)),
                        consumo_medio: parseFloat(allTimeMedia.toFixed(2))
                    },
                    comparacao_vs_periodo_anterior: {
                        distancia_perc: parseFloat(calcVariacao(current30.distancia, prev30.distancia).toFixed(1)),
                        custo_perc: parseFloat(calcVariacao(current30.custo, prev30.custo).toFixed(1)),
                        consumo_medio_perc: parseFloat(calcVariacao(currentMedia, prevMedia).toFixed(1))
                    }
                },
                previsoes_30d: {
                    distancia_esperada_km: parseFloat((diariaDistancia * 30).toFixed(2)),
                    custo_esperado_euros: parseFloat((diariaCusto * 30).toFixed(2))
                },
                cronologia
            });
        });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao calcular estatísticas.' });
    }
});

// Comparação entre múltiplos veículos num dado período
app.get('/estatisticas/comparacao', async (req, res) => {
    const matriculas = req.query.matriculas ? req.query.matriculas.split(',') : [];
    const dataInicio = req.query.dataInicio;
    const dataFim = req.query.dataFim;

    if (matriculas.length === 0) {
        return res.status(400).json({ erro: 'Forneça pelo menos uma matrícula para comparar.' });
    }

    try {
        const resultados = [];
        for (let mat of matriculas) {
            const matricula = mat.trim().toUpperCase();
            const veiculo = await dbGet('SELECT * FROM veiculos WHERE UPPER(matricula) = ?', [matricula]);
            if (!veiculo) continue;

            let sqlViagens = `SELECT * FROM viagens WHERE UPPER(veiculo_matricula) = ?`;
            const params = [matricula];
            
            if (dataInicio && dataFim) {
                sqlViagens += ` AND data_hora >= ? AND data_hora <= ?`;
                params.push(dataInicio.includes('T') ? dataInicio : `${dataInicio}T00:00:00.000Z`);
                params.push(dataFim.includes('T') ? dataFim : `${dataFim}T23:59:59.999Z`);
            }
            sqlViagens += ` ORDER BY data_hora ASC`;

            const viagens = await new Promise((resolve, reject) => {
                db.all(sqlViagens, params, (err, rows) => err ? reject(err) : resolve(rows));
            });

            let totalDistancia = 0;
            let totalCusto = 0;
            let totalLitros = 0;
            let cronologia = [];

            viagens.forEach(v => {
                if (v.distancia_viagem > 0) {
                    totalDistancia += v.distancia_viagem;
                    totalCusto += v.valor_euros;
                    totalLitros += v.litros;
                    
                    cronologia.push({
                        data: v.data_hora,
                        distancia: v.distancia_viagem,
                        consumo_l_100km: parseFloat(((v.litros / v.distancia_viagem) * 100).toFixed(2)),
                        custo_por_km: parseFloat((v.valor_euros / v.distancia_viagem).toFixed(3)),
                        custo_total: v.valor_euros
                    });
                }
            });

            const consumoMedio = totalDistancia > 0 ? parseFloat(((totalLitros / totalDistancia) * 100).toFixed(2)) : 0;
            const custoPorKm = totalDistancia > 0 ? parseFloat((totalCusto / totalDistancia).toFixed(3)) : 0;

            resultados.push({
                matricula: veiculo.matricula,
                nome: veiculo.nome,
                totais: {
                    distancia_km: parseFloat(totalDistancia.toFixed(2)),
                    custo_euros: parseFloat(totalCusto.toFixed(2)),
                    consumo_medio: consumoMedio,
                    custo_por_km: custoPorKm
                },
                cronologia
            });
        }

        res.status(200).json({ comparacao: resultados });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao calcular estatísticas de comparação.' });
    }
});

// ==========================================
// 5. ROTAS DE MÉTRICAS E LOGS DO SISTEMA
// ==========================================

// Obter métricas globais e de desempenho do servidor
app.get('/metricas', async (req, res) => {
    const correrQuery = (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, linhas) => err ? reject(err) : resolve(linhas));
    });

    try {
        // 1. Frota & Viagens
        const [veiculos] = await correrQuery(`SELECT COUNT(*) as count FROM veiculos`);
        const [frota] = await correrQuery(`SELECT SUM(distancia_viagem) as distancia, SUM(valor_euros) as custo, COUNT(id) as viagens FROM viagens`);
        
        // 2. Viagens ao longo do tempo (últimos 30 dias)
        const viagens30d = await correrQuery(`
            SELECT strftime('%Y-%m-%d', data_hora) as data, COUNT(id) as total_viagens, SUM(valor_euros) as custo_dia 
            FROM viagens 
            WHERE data_hora >= date('now', '-30 days') 
            GROUP BY data ORDER BY data ASC
        `);

        // 3. Distribuição de Tipos de Veículo
        const tiposVeiculos = await correrQuery(`SELECT tipo_veiculo, COUNT(*) as count FROM veiculos GROUP BY tipo_veiculo`);

        // 4. Logs e Desempenho da API
        const sqlDiario = `SELECT strftime('%Y-%m-%d', timestamp) as periodo, COUNT(id) as total_pedidos, ROUND(AVG(latencia_ms), 2) as latencia_media_ms FROM logs GROUP BY periodo ORDER BY periodo DESC LIMIT 7`;
        const diario = await correrQuery(sqlDiario);
        
        const topEndpoints = await correrQuery(`
            SELECT url, metodo, COUNT(id) as acessos, ROUND(AVG(latencia_ms), 2) as latencia_media
            FROM logs 
            GROUP BY url, metodo 
            ORDER BY acessos DESC LIMIT 5
        `);

        const [erros7d] = await correrQuery(`
            SELECT COUNT(id) as total_pedidos, SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) as total_erros 
            FROM logs 
            WHERE timestamp >= date('now', '-7 days')
        `);

        const taxaErros = erros7d.total_pedidos > 0 ? ((erros7d.total_erros / erros7d.total_pedidos) * 100).toFixed(2) : 0;

        res.status(200).json({
            frota: {
                total_veiculos: veiculos.count,
                total_viagens: frota.viagens || 0,
                distancia_total: parseFloat((frota.distancia || 0).toFixed(2)),
                custo_total: parseFloat((frota.custo || 0).toFixed(2)),
                tipos_veiculo: tiposVeiculos
            },
            graficos: {
                viagens_30d: viagens30d
            },
            api_health: {
                diario,
                top_endpoints: topEndpoints,
                taxa_erros_7d_perc: parseFloat(taxaErros)
            }
        });
    } catch (e) {
        res.status(500).json({ erro: 'Falha ao recolher as métricas do dashboard.' });
    }
});

// Obter logs de acesso detalhados (com paginação)
app.get('/logs', (req, res) => {
    const limite = parseInt(req.query.limite) || 50;
    const salto = parseInt(req.query.salto) || 0;

    db.all('SELECT * FROM logs ORDER BY timestamp DESC LIMIT ? OFFSET ?', [limite, salto], (err, linhas) => {
        if (err) return res.status(500).json({ erro: 'Falha ao obter os logs.' });
        res.status(200).json({ total_devolvido: linhas.length, limite, salto, logs: linhas });
    });
});

// ==========================================
// 6. TRATAMENTO DE ERROS (404)
// ==========================================

// Middleware Catch-All para rotas não encontradas (404)
// Tem de ser SEMPRE a última rota definida antes do app.listen!
app.use((req, res) => {
    res.status(404).json({
        erro: 'Endpoint não encontrado.',
        metodo_recebido: req.method,
        url_recebida: req.originalUrl,
    });
});

// ==========================================
// 7. ARRANQUE E MANUTENÇÃO
// ==========================================

function limparLogsAntigos() {
    db.run(`DELETE FROM logs WHERE timestamp <= datetime('now', '-30 days')`, function (err) {
        if (!err && this.changes > 0) console.log(`Limpeza: ${this.changes} logs de sistema antigos apagados.`);
    });
}

app.listen(porta, () => {
    console.log(`API de Veículos a correr na porta ${porta}`);
    limparLogsAntigos();
    setInterval(limparLogsAntigos, 86400000); // 24h
});