const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./servidor.db');

const veiculos = [
    {
        matricula: 'AA-11-AA',
        nome: 'Renault Clio (Fictício)',
        quilometros_iniciais: 10000,
        tipo_combustivel: 'Gasóleo',
        tipo_veiculo: 'Ligeiro',
        consumo_base: 5.2 // L/100km
    },
    {
        matricula: 'BB-22-BB',
        nome: 'Toyota Corolla (Fictício)',
        quilometros_iniciais: 25000,
        tipo_combustivel: 'Gasolina',
        tipo_veiculo: 'Ligeiro',
        consumo_base: 6.8 // L/100km
    }
];

function getRandomArbitrary(min, max) {
    return Math.random() * (max - min) + min;
}

db.serialize(() => {
    // 1. Inserir Veículos
    const stmtVeiculo = db.prepare(`INSERT OR IGNORE INTO veiculos (matricula, nome, quilometros_iniciais, tipo_combustivel, tipo_veiculo, data_registo) VALUES (?, ?, ?, ?, ?, ?)`);
    
    veiculos.forEach(v => {
        stmtVeiculo.run(v.matricula, v.nome, v.quilometros_iniciais, v.tipo_combustivel, v.tipo_veiculo, new Date().toISOString());
    });
    stmtVeiculo.finalize();

    console.log('Veículos inseridos/verificados com sucesso.');

    // 2. Inserir Consumos (Viagens)
    // Vamos gerar 10 abastecimentos para cada veículo nos últimos 6 meses
    const stmtViagem = db.prepare(`INSERT INTO viagens (veiculo_matricula, quilometros_totais, distancia_viagem, tipo_abastecimento, litros, valor_euros, data_hora, descricao) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    const precosCombustivel = {
        'Gasóleo': 1.65,
        'Gasolina': 1.80
    };

    veiculos.forEach(v => {
        let currentKm = v.quilometros_iniciais;
        let dataHoraAtual = new Date();
        dataHoraAtual.setMonth(dataHoraAtual.getMonth() - 6); // Começar há 6 meses atrás

        for (let i = 0; i < 10; i++) {
            // Avançar a data 1 a 3 semanas
            dataHoraAtual.setDate(dataHoraAtual.getDate() + getRandomArbitrary(7, 21));
            
            // Gerar distância entre 300 e 800 km
            const distancia = parseFloat(getRandomArbitrary(300, 800).toFixed(2));
            currentKm += distancia;

            // Gerar litros baseado no consumo base + variação
            const consumoReal = v.consumo_base * getRandomArbitrary(0.9, 1.15); // Variação de -10% a +15%
            const litros = parseFloat(((consumoReal * distancia) / 100).toFixed(2));

            // Calcular o custo
            const precoLitro = precosCombustivel[v.tipo_combustivel] * getRandomArbitrary(0.95, 1.05); // Variação no preço
            const valorEuros = parseFloat((litros * precoLitro).toFixed(2));

            stmtViagem.run(
                v.matricula, 
                parseFloat(currentKm.toFixed(2)), 
                distancia, 
                'Completo', 
                litros, 
                valorEuros, 
                dataHoraAtual.toISOString(), 
                `Abastecimento gerado automaticamente #${i + 1}`
            );
        }
    });
    
    stmtViagem.finalize();
    console.log('Abastecimentos (viagens) inseridos com sucesso!');
});

db.close();
