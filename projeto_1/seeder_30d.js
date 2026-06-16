const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'servidor.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao ligar ao SQLite:', err.message);
        process.exit(1);
    }
    console.log('Ligação ao SQLite estabelecida com sucesso.');
});

// Configurações do Seeder
const DATA_REFERENCIA = new Date('2026-06-16T19:00:00Z');
const DIAS_A_GERAR = 30;

const veiculos = [
    {
        matricula: 'AA-11-AA',
        nome: 'Renault Clio (Fictício)',
        quilometros_iniciais: 10000,
        tipo_combustivel: 'Gasóleo',
        tipo_veiculo: 'Ligeiro',
        consumo_medio: 5.2,
        custo_litro: 1.65
    },
    {
        matricula: 'BB-22-BB',
        nome: 'Toyota Corolla (Fictício)',
        quilometros_iniciais: 25000,
        tipo_combustivel: 'Gasolina',
        tipo_veiculo: 'Ligeiro',
        consumo_medio: 6.8,
        custo_litro: 1.80
    },
    {
        matricula: 'CC-33-CC',
        nome: 'Peugeot 308 (Fictício)',
        quilometros_iniciais: 45000,
        tipo_combustivel: 'Gasóleo',
        tipo_veiculo: 'Ligeiro',
        consumo_medio: 5.5,
        custo_litro: 1.65
    },
    {
        matricula: 'DD-44-DD',
        nome: 'Ford Transit (Fictício)',
        quilometros_iniciais: 120000,
        tipo_combustivel: 'Gasóleo',
        tipo_veiculo: 'Comercial',
        consumo_medio: 8.5,
        custo_litro: 1.65
    },
    {
        matricula: 'EE-55-EE',
        nome: 'Volkswagen Golf (Fictício)',
        quilometros_iniciais: 15000,
        tipo_combustivel: 'Gasolina',
        tipo_veiculo: 'Ligeiro',
        consumo_medio: 6.2,
        custo_litro: 1.80
    }
];

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function subDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() - days);
    return result;
}

const DATA_INICIO = new Date('2026-05-07T08:00:00Z');
const DATA_FIM = new Date('2026-06-16T19:00:00Z');

async function runSeeder() {
    console.log('A inserir/verificar veículos...');
    const stmtVeiculo = db.prepare(`INSERT OR IGNORE INTO veiculos (matricula, nome, quilometros_iniciais, tipo_combustivel, tipo_veiculo, data_registo) VALUES (?, ?, ?, ?, ?, ?)`);
    
    veiculos.forEach(v => {
        const dataRegisto = subDays(DATA_INICIO, 5).toISOString();
        stmtVeiculo.run(v.matricula, v.nome, v.quilometros_iniciais, v.tipo_combustivel, v.tipo_veiculo, dataRegisto);
    });
    stmtVeiculo.finalize();

    console.log('A verificar os últimos KMs e a gerar viagens a partir de 07/05...');
    const stmtViagem = db.prepare(`INSERT INTO viagens (veiculo_matricula, quilometros_totais, distancia_viagem, tipo_abastecimento, litros, valor_euros, data_hora, descricao) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    for (const v of veiculos) {
        const row = await new Promise((resolve, reject) => {
            db.get('SELECT MAX(quilometros_totais) as max_km FROM viagens WHERE veiculo_matricula = ?', [v.matricula], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        let kmsAtuais = (row && row.max_km !== null) ? row.max_km : v.quilometros_iniciais;
        
        // Começa a gerar viagens a partir do dia 07/05/2026
        let currentDate = new Date(DATA_INICIO.getTime());
        
        while (currentDate <= DATA_FIM) {
            const distancia = getRandomInt(50, 400); // Viagens entre 50km e 400km
            kmsAtuais += distancia;
            
            // Variância no consumo (±10%)
            const variancia = (Math.random() * 0.2) + 0.9; 
            const consumoReal = v.consumo_medio * variancia;
            
            const litrosUsados = parseFloat(((distancia / 100) * consumoReal).toFixed(2));
            const custoAbastecimento = parseFloat((litrosUsados * v.custo_litro).toFixed(2));
            
            // Hora aleatória durante esse dia
            const dataViagem = new Date(currentDate.getTime());
            dataViagem.setHours(getRandomInt(8, 20), getRandomInt(0, 59));

            let tipoAbastecimento = v.tipo_combustivel === 'Elétrico' ? 'Carregamento Elétrico' : 'Atesto Completo';
            if (v.tipo_combustivel !== 'Elétrico' && Math.random() > 0.7) {
                tipoAbastecimento = 'Abastecimento Parcial';
            }

            stmtViagem.run(
                v.matricula,
                parseFloat(kmsAtuais.toFixed(2)),
                distancia,
                tipoAbastecimento,
                litrosUsados,
                custoAbastecimento,
                dataViagem.toISOString(),
                `Viagem gerada automaticamente a partir de 07/05.`
            );

            // Avança no tempo entre 2 a 4 dias para a próxima viagem
            currentDate.setDate(currentDate.getDate() + getRandomInt(2, 4));
        }
    }

    stmtViagem.finalize(() => {
        console.log('Seeder concluído com sucesso!');
        db.close();
    });
}

runSeeder().catch(err => console.error('Erro no seeder:', err));
