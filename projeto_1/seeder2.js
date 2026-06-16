const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./servidor.db');

// Novos veículos com matrículas diferentes para não sobrepor com os originais
const novosVeiculos = [
    {
        matricula: 'CC-33-CC',
        nome: 'Peugeot 308 (Fictício)',
        quilometros_iniciais: 45000,
        tipo_combustivel: 'Gasóleo',
        tipo_veiculo: 'Ligeiro',
        consumo_base: 5.5 // L/100km
    },
    {
        matricula: 'DD-44-DD',
        nome: 'Ford Transit (Fictício)',
        quilometros_iniciais: 120000,
        tipo_combustivel: 'Gasóleo',
        tipo_veiculo: 'Comercial',
        consumo_base: 8.5 // L/100km
    },
    {
        matricula: 'EE-55-EE',
        nome: 'Volkswagen Golf (Fictício)',
        quilometros_iniciais: 15000,
        tipo_combustivel: 'Gasolina',
        tipo_veiculo: 'Ligeiro',
        consumo_base: 6.2 // L/100km
    }
];

function getRandomArbitrary(min, max) {
    return Math.random() * (max - min) + min;
}

db.serialize(() => {
    // 1. Inserir Novos Veículos
    const stmtVeiculo = db.prepare(`INSERT OR IGNORE INTO veiculos (matricula, nome, quilometros_iniciais, tipo_combustivel, tipo_veiculo, data_registo) VALUES (?, ?, ?, ?, ?, ?)`);
    
    novosVeiculos.forEach(v => {
        stmtVeiculo.run(v.matricula, v.nome, v.quilometros_iniciais, v.tipo_combustivel, v.tipo_veiculo, new Date().toISOString());
    });
    stmtVeiculo.finalize();

    console.log('Novos veículos adicionados/verificados com sucesso.');

    // 2. Inserir Consumos (Viagens) para os novos veículos
    // Vamos gerar 15 abastecimentos para cada veículo nos últimos 6 meses
    const stmtViagem = db.prepare(`INSERT INTO viagens (veiculo_matricula, quilometros_totais, distancia_viagem, tipo_abastecimento, litros, valor_euros, data_hora, descricao) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    const precosCombustivel = {
        'Gasóleo': 1.65,
        'Gasolina': 1.80
    };

    novosVeiculos.forEach(v => {
        let currentKm = v.quilometros_iniciais;
        let dataHoraAtual = new Date();
        dataHoraAtual.setMonth(dataHoraAtual.getMonth() - 6); // Começar há 6 meses atrás

        for (let i = 0; i < 15; i++) {
            // Avançar a data de 5 a 15 dias para criar mais densidade de pontos
            dataHoraAtual.setDate(dataHoraAtual.getDate() + getRandomArbitrary(5, 15));
            
            // Gerar distância percorrida entre o último abastecimento e este (entre 200 e 600 km)
            const distancia = parseFloat(getRandomArbitrary(200, 600).toFixed(2));
            currentKm += distancia;

            // Gerar litros baseado no consumo base + variação de -10% a +25% consoante o trânsito etc
            const consumoReal = v.consumo_base * getRandomArbitrary(0.9, 1.25);
            const litros = parseFloat(((consumoReal * distancia) / 100).toFixed(2));

            // Calcular o custo com flutuação de mercado
            const precoLitro = precosCombustivel[v.tipo_combustivel] * getRandomArbitrary(0.95, 1.05);
            const valorEuros = parseFloat((litros * precoLitro).toFixed(2));

            stmtViagem.run(
                v.matricula, 
                parseFloat(currentKm.toFixed(2)), 
                distancia, 
                'Completo', 
                litros, 
                valorEuros, 
                dataHoraAtual.toISOString(), 
                `Abastecimento de Rotina #${i + 1} (Seeder 2)`
            );
        }
    });
    
    stmtViagem.finalize();
    console.log('Abastecimentos gerados para os novos veículos com sucesso!');
});

db.close();
