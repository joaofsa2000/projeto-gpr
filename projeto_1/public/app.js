const app = {
    veiculos: [],
    viagensAtuais: [],
    charts: {
        consumo: null,
        custo: null,
        dashViagens: null,
        dashTipos: null
    },
    activeVehicleMatricula: null,
    currentVehicleData: null,
    veiculosComparacaoAtivos: [],
    datasComparacao: { inicio: null, fim: null },
    
    
    init() {
        this.setupNavigation();
        this.loadDashboardMetrics();
        this.checkServerStatus();

        // Handle initial hash routing
        const hash = window.location.hash || '#dashboard';
        this.navigate(hash.substring(1));
    },

    setupNavigation() {
        document.querySelectorAll('.nav-links a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const view = e.currentTarget.getAttribute('data-view');
                window.location.hash = view;
                this.navigate(view);
            });
        });

        // Update selected vehicle in Viagens view
        const selectVeiculo = document.getElementById('select-veiculo-viagens');
        selectVeiculo.addEventListener('change', (e) => {
            const btn = document.getElementById('btn-nova-viagem');
            if (e.target.value) {
                btn.removeAttribute('disabled');
                this.loadViagens(e.target.value);
            } else {
                btn.setAttribute('disabled', 'true');
                document.querySelector('#tabela-viagens tbody').innerHTML = '';
            }
        });
    },

    navigate(viewId, params = {}) {
        // Update active link
        document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
        const activeLink = document.querySelector(`.nav-links a[data-view="${viewId}"]`);
        if(activeLink) activeLink.classList.add('active');

        // Update page title
        const titles = {
            'dashboard': 'Dashboard',
            'veiculos': 'Gestão de Veículos',
            'viagens': 'Viagens e Consumos',
            'detalhes': 'Detalhes do Veículo',
            'logs': 'Logs de Sistema'
        };
        document.getElementById('page-title').textContent = titles[viewId] || 'Gestão';

        // Hide all views, show selected
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
        const viewEl = document.getElementById(`view-${viewId}`);
        if(viewEl) viewEl.classList.add('active-view');

        // Load data based on view
        if (viewId === 'dashboard') this.loadDashboardMetrics();
        if (viewId === 'veiculos') this.loadVeiculos();
        if (viewId === 'viagens') this.setupViagensView();
        if (viewId === 'detalhes') this.loadVehicleDetails(params.matricula);
        if (viewId === 'logs') this.loadLogs();
    },

    async apiCall(endpoint, method = 'GET', body = null) {
        try {
            const options = { method, headers: { 'Content-Type': 'application/json' } };
            if (body) options.body = JSON.stringify(body);
            
            const res = await fetch(endpoint, options);
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.erro || 'Erro na API');
            
            this.setServerStatus(true);
            return data;
        } catch (error) {
            this.setServerStatus(false);
            this.showToast(error.message, 'error');
            throw error;
        }
    },

    setServerStatus(online) {
        const ind = document.querySelector('.status-indicator');
        if (online) {
            ind.classList.remove('offline');
            ind.classList.add('online');
        } else {
            ind.classList.remove('online');
            ind.classList.add('offline');
        }
    },

    checkServerStatus() {
        setInterval(() => {
            fetch('/favicon.ico').then(() => this.setServerStatus(true)).catch(() => this.setServerStatus(false));
        }, 10000);
    },

    // ==========================================
    // METRICS / DASHBOARD
    // ==========================================
    async loadDashboardMetrics() {
        try {
            const data = await this.apiCall('/metricas');

            // 1. Preencher KPIs Globais da Frota
            document.getElementById('dash-total-veiculos').textContent = data.frota.total_veiculos;
            document.getElementById('dash-total-viagens').textContent = data.frota.total_viagens;
            document.getElementById('dash-custo-global').textContent = `${data.frota.custo_total} €`;
            document.getElementById('dash-distancia-global').textContent = `${data.frota.distancia_total} km`;

            // 2. Preencher KPIs de Saúde da API
            const hoje = data.api_health.diario[0] || { total_pedidos: 0, latencia_media_ms: 0 };
            document.getElementById('dash-pedidos-hoje').textContent = hoje.total_pedidos;
            document.getElementById('dash-latencia-media').textContent = `${hoje.latencia_media_ms} ms`;
            document.getElementById('dash-taxa-erros').textContent = `${data.api_health.taxa_erros_7d_perc} %`;

            // 3. Preencher Tabela de Top Endpoints
            const tbody = document.querySelector('#tabela-top-endpoints tbody');
            tbody.innerHTML = '';
            data.api_health.top_endpoints.forEach(ep => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                tr.innerHTML = `
                    <td style="padding: 8px;"><span style="background: rgba(139, 92, 246, 0.2); padding: 2px 6px; border-radius: 4px; font-size: 0.8rem;">${ep.metodo}</span></td>
                    <td style="padding: 8px; font-family: monospace;">${ep.url}</td>
                    <td style="padding: 8px;">${ep.acessos}</td>
                    <td style="padding: 8px;">${ep.latencia_media} ms</td>
                `;
                tbody.appendChild(tr);
            });

            // 4. Renderizar Gráficos
            this.renderDashboardCharts(data.graficos.viagens_30d, data.frota.tipos_veiculo);
            
        } catch (e) {
            console.error('Falha ao carregar dashboard', e);
        }
    },

    renderDashboardCharts(viagensData, tiposData) {
        // Gráfico de Viagens Registadas (Linha)
        if (this.charts.dashViagens) this.charts.dashViagens.destroy();
        const ctxViagens = document.getElementById('chart-dash-viagens').getContext('2d');
        
        this.charts.dashViagens = new Chart(ctxViagens, {
            type: 'line',
            data: {
                labels: viagensData.map(v => {
                    const d = new Date(v.data);
                    return `${d.getDate()}/${d.getMonth()+1}`;
                }),
                datasets: [{
                    label: 'Viagens',
                    data: viagensData.map(v => v.total_viagens),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', stepSize: 1 } }
                }
            }
        });

        // Gráfico de Distribuição de Tipos (Doughnut)
        if (this.charts.dashTipos) this.charts.dashTipos.destroy();
        const ctxTipos = document.getElementById('chart-dash-tipos').getContext('2d');

        const labels = tiposData.map(t => t.tipo_veiculo);
        const dataVals = tiposData.map(t => t.count);

        this.charts.dashTipos = new Chart(ctxTipos, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: dataVals,
                    backgroundColor: ['#3b82f6', '#f59e0b', '#8b5cf6', '#10b981'],
                    borderColor: '#1e293b',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: '#94a3b8' } }
                }
            }
        });
    },

    // ==========================================
    // VEICULOS
    // ==========================================
    async loadVeiculos() {
        try {
            const data = await this.apiCall('/veiculos');
            this.veiculos = data.veiculos;
            const tbody = document.querySelector('#tabela-veiculos tbody');
            tbody.innerHTML = '';

            data.veiculos.forEach(v => {
                const tr = document.createElement('tr');
                const dataFormatada = new Date(v.data_registo).toLocaleDateString('pt-PT');
                tr.innerHTML = `
                    <td><strong>${v.matricula}</strong></td>
                    <td>${v.nome}</td>
                    <td>${v.tipo_combustivel}</td>
                    <td>${v.tipo_veiculo}</td>
                    <td>${v.quilometros_iniciais} / <strong>${v.quilometros_atuais || v.quilometros_iniciais}</strong></td>
                    <td>${dataFormatada}</td>
                    <td>
                        <div class="actions-cell">
                            <button class="btn-icon" title="Ver estatísticas" onclick="app.verDetalhesVeiculo('${v.matricula}')">
                                <i class='bx bx-bar-chart-alt-2'></i>
                            </button>
                            <button class="btn-icon" title="Editar veículo" onclick="app.abrirEditarVeiculo('${v.matricula}')">
                                <i class='bx bx-edit'></i>
                            </button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) { }
    },

    async submitVeiculo(e) {
        e.preventDefault();
        const payload = {
            matricula: document.getElementById('v-matricula').value.toUpperCase(),
            nome: document.getElementById('v-nome').value,
            quilometros_iniciais: parseFloat(document.getElementById('v-km').value),
            tipo_combustivel: document.getElementById('v-combustivel').value,
            tipo_veiculo: document.getElementById('v-tipo').value
        };

        try {
            await this.apiCall('/veiculos', 'POST', payload);
            this.showToast('Veículo registado com sucesso!', 'success');
            this.closeModal('modal-veiculo');
            document.getElementById('form-veiculo').reset();
            this.loadVeiculos();
        } catch (e) {}
    },

    abrirEditarVeiculo(matricula) {
        const v = this.veiculos.find(veh => veh.matricula === matricula);
        if (!v) return;

        document.getElementById('edit-v-original-matricula').value = v.matricula;
        document.getElementById('edit-v-matricula').value = v.matricula;
        document.getElementById('edit-v-nome').value = v.nome;
        document.getElementById('edit-v-combustivel').value = v.tipo_combustivel;
        document.getElementById('edit-v-tipo').value = v.tipo_veiculo;

        this.showModal('modal-edit-veiculo');
    },

    async submitEditVeiculo(e) {
        e.preventDefault();
        const matricula = document.getElementById('edit-v-original-matricula').value;
        const payload = {
            nome: document.getElementById('edit-v-nome').value,
            tipo_combustivel: document.getElementById('edit-v-combustivel').value,
            tipo_veiculo: document.getElementById('edit-v-tipo').value
        };

        try {
            await this.apiCall(`/veiculos/${matricula}`, 'PUT', payload);
            this.showToast('Veículo atualizado com sucesso!', 'success');
            this.closeModal('modal-edit-veiculo');
            this.loadVeiculos();
        } catch (e) {}
    },

    verDetalhesVeiculo(matricula) {
        window.location.hash = `detalhes/${matricula}`;
        this.navigate('detalhes', { matricula });
    },

    // ==========================================
    // VIAGENS
    // ==========================================
    async setupViagensView() {
        await this.loadVeiculos(); // Ensure we have vehicles
        const select = document.getElementById('select-veiculo-viagens');
        
        // Save current selection
        const currentSelection = select.value;
        
        select.innerHTML = '<option value="">Selecione um veículo...</option>';
        this.veiculos.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.matricula;
            opt.textContent = `${v.matricula} - ${v.nome}`;
            select.appendChild(opt);
        });

        if (currentSelection) {
            select.value = currentSelection;
            this.loadViagens(currentSelection);
        }
    },

    async loadViagens(matricula) {
        try {
            const data = await this.apiCall(`/veiculos/${matricula}/viagens`);
            this.viagensAtuais = data.historico;
            const tbody = document.querySelector('#tabela-viagens tbody');
            tbody.innerHTML = '';

            if(data.historico.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--text-muted)">Sem viagens registadas.</td></tr>';
                return;
            }

            data.historico.forEach(v => {
                const tr = document.createElement('tr');
                const dataFormatada = new Date(v.data_hora).toLocaleString('pt-PT');
                tr.innerHTML = `
                    <td>${dataFormatada}</td>
                    <td>${v.quilometros_totais} Km</td>
                    <td>${v.distancia_viagem} Km</td>
                    <td>${v.litros} L</td>
                    <td>${v.valor_euros} €</td>
                    <td style="color: var(--primary-color); font-weight: bold;">${v.consumo_l_100km ? v.consumo_l_100km + ' L/100km' : '--'}</td>
                    <td style="color: var(--success-color);">${v.custo_por_km_euros ? v.custo_por_km_euros + ' €/Km' : '--'}</td>
                    <td>
                        <div class="actions-cell">
                            <button class="btn-icon" title="Editar viagem" onclick="app.abrirEditarViagem(${v.id})">
                                <i class='bx bx-edit'></i>
                            </button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) {}
    },

    async submitViagem(e) {
        e.preventDefault();
        const select = document.getElementById('select-veiculo-viagens');
        const matricula = select.value;

        if (!matricula) {
            this.showToast('Selecione um veículo primeiro.', 'error');
            return;
        }

        const payload = {
            quilometros_totais: parseFloat(document.getElementById('vi-km-totais').value),
            tipo_abastecimento: document.getElementById('vi-tipo').value,
            litros: parseFloat(document.getElementById('vi-litros').value),
            valor_euros: parseFloat(document.getElementById('vi-valor').value),
            descricao: document.getElementById('vi-descricao').value
        };

        try {
            await this.apiCall(`/veiculos/${matricula}/viagens`, 'POST', payload);
            this.showToast('Abastecimento registado com sucesso!', 'success');
            this.closeModal('modal-viagem');
            document.getElementById('form-viagem').reset();
            this.loadViagens(matricula);
        } catch (e) {}
    },

    abrirEditarViagem(id) {
        const v = this.viagensAtuais.find(vi => vi.id === id);
        if (!v) return;

        document.getElementById('edit-vi-id').value = v.id;
        document.getElementById('edit-vi-matricula').value = v.veiculo_matricula;
        document.getElementById('edit-vi-km-totais').value = v.quilometros_totais;
        document.getElementById('edit-vi-litros').value = v.litros;
        document.getElementById('edit-vi-valor').value = v.valor_euros;
        document.getElementById('edit-vi-tipo').value = v.tipo_abastecimento;
        document.getElementById('edit-vi-descricao').value = v.descricao || '';

        this.showModal('modal-edit-viagem');
    },

    async submitEditViagem(e) {
        e.preventDefault();
        const id = document.getElementById('edit-vi-id').value;
        const matricula = document.getElementById('edit-vi-matricula').value;
        const payload = {
            litros: parseFloat(document.getElementById('edit-vi-litros').value),
            valor_euros: parseFloat(document.getElementById('edit-vi-valor').value),
            tipo_abastecimento: document.getElementById('edit-vi-tipo').value,
            descricao: document.getElementById('edit-vi-descricao').value
        };

        try {
            await this.apiCall(`/viagens/${id}`, 'PUT', payload);
            this.showToast('Viagem atualizada com sucesso!', 'success');
            this.closeModal('modal-edit-viagem');
            this.loadViagens(matricula);
        } catch (e) {}
    },

    // ==========================================
    // DETALHES & ESTATISTICAS (Gráficos)
    // ==========================================
    async loadVehicleDetails(matricula) {
        if (!matricula) {
            const hash = window.location.hash;
            if (hash.startsWith('#detalhes/')) {
                matricula = hash.split('/')[1];
            } else {
                this.navigate('veiculos');
                return;
            }
        }
        this.activeVehicleMatricula = matricula;

        try {
            if (this.veiculosComparacaoAtivos && this.veiculosComparacaoAtivos.length > 0 && this.datasComparacao.inicio) {
                document.getElementById('kpi-period-select').style.display = 'none';
                document.getElementById('previsoes-container').style.display = 'none';

                const matriculas = [matricula, ...this.veiculosComparacaoAtivos].join(',');
                const dataComp = await this.apiCall(`/estatisticas/comparacao?matriculas=${matriculas}&dataInicio=${this.datasComparacao.inicio}&dataFim=${this.datasComparacao.fim}`);
                
                const mainVeiculo = dataComp.comparacao.find(v => v.matricula === matricula);
                if (!mainVeiculo) throw new Error("Erro ao carregar veículo principal.");
                
                document.getElementById('detalhes-titulo').textContent = `${mainVeiculo.nome} (${matricula})`;
                document.getElementById('info-combustivel').innerHTML = `<i class='bx bx-git-compare'></i> Comparação Personalizada`;
                document.getElementById('info-km').innerHTML = `<i class='bx bx-calendar'></i> ${this.datasComparacao.inicio} até ${this.datasComparacao.fim}`;

                document.getElementById('kpi-distancia-title').textContent = 'Distância';
                document.getElementById('kpi-custo-title').textContent = 'Total Gasto';
                document.getElementById('kpi-consumo-title').textContent = 'Consumo Médio';

                document.getElementById('kpi-distancia').textContent = `${mainVeiculo.totais.distancia_km} Km`;
                document.getElementById('kpi-custo').textContent = `${mainVeiculo.totais.custo_euros} €`;
                document.getElementById('kpi-consumo').textContent = `${mainVeiculo.totais.consumo_medio} L/100km`;

                this.renderMultipleBadges('kpi-distancia-comparacao-container', mainVeiculo.totais.distancia_km, dataComp.comparacao, 'distancia_km', 'up-good');
                this.renderMultipleBadges('kpi-custo-comparacao-container', mainVeiculo.totais.custo_euros, dataComp.comparacao, 'custo_euros', 'down-good');
                this.renderMultipleBadges('kpi-consumo-comparacao-container', mainVeiculo.totais.consumo_medio, dataComp.comparacao, 'consumo_medio', 'down-good');

                this.renderChartsMulti(dataComp.comparacao);
            } else {
                document.getElementById('kpi-period-select').style.display = 'block';
                document.getElementById('previsoes-container').style.display = 'flex';

                const data = await this.apiCall(`/veiculos/${matricula}/estatisticas`);
                this.currentVehicleData = data;
                
                document.getElementById('detalhes-titulo').textContent = `${data.veiculo} (${matricula})`;
                document.getElementById('info-combustivel').innerHTML = `<i class='bx bx-gas-pump'></i> ${data.tipo_combustivel}`;
                document.getElementById('info-km').innerHTML = `<i class='bx bx-tachometer'></i> ${data.quilometros_atuais} km atuais`;

                document.getElementById('prev-dist').textContent = `${data.previsoes_30d.distancia_esperada_km} km`;
                document.getElementById('prev-custo').textContent = `${data.previsoes_30d.custo_esperado_euros} €`;

                this.updateKpiDisplay();

                this.renderChartsMulti([{
                    matricula: matricula,
                    nome: data.veiculo,
                    cronologia: data.cronologia
                }]);
            }
            
            this.populateCompVeiculos(matricula);
        } catch (e) {
            console.error(e);
            this.navigate('veiculos');
        }
    },

    updateKpiDisplay() {
        if (!this.currentVehicleData) return;
        
        const period = document.getElementById('kpi-period-select').value;
        const data = this.currentVehicleData;
        const kpis = period === 'all' ? data.kpis.todo_o_tempo : data.kpis.ultimos_30_dias;
        const comps = data.kpis.comparacao_vs_periodo_anterior;

        document.getElementById('kpi-distancia-title').textContent = period === 'all' ? 'Distância (Total)' : 'Distância (30d)';
        document.getElementById('kpi-distancia').textContent = `${kpis.distancia_km} Km`;
        
        document.getElementById('kpi-custo-title').textContent = period === 'all' ? 'Total Gasto (Total)' : 'Total Gasto (30d)';
        document.getElementById('kpi-custo').textContent = `${kpis.custo_euros} €`;
        
        document.getElementById('kpi-consumo-title').textContent = period === 'all' ? 'Consumo Médio (Total)' : 'Consumo Médio (30d)';
        document.getElementById('kpi-consumo').textContent = `${kpis.consumo_medio} L/100km`;

        if (period === 'all') {
            document.getElementById('kpi-distancia-comparacao-container').innerHTML = '';
            document.getElementById('kpi-custo-comparacao-container').innerHTML = '';
            document.getElementById('kpi-consumo-comparacao-container').innerHTML = '';
        } else {
            this.renderTrendBadgeOriginal('kpi-distancia-comparacao-container', comps.distancia_km_perc || comps.distancia_perc, 'up-good');
            this.renderTrendBadgeOriginal('kpi-custo-comparacao-container', comps.custo_euros_perc || comps.custo_perc, 'down-good');
            this.renderTrendBadgeOriginal('kpi-consumo-comparacao-container', comps.consumo_medio_perc, 'down-good');
        }
    },

    renderTrendBadgeOriginal(containerId, value, goodDirection) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        const badge = document.createElement('span');

        if (value === undefined || value === null || isNaN(value)) {
            badge.textContent = 'Sem dados anteriores';
            badge.className = 'trend-badge neutral';
        } else {
            const formatVal = value > 0 ? `+${value.toFixed(1)}%` : `${value.toFixed(1)}%`;
            badge.textContent = `${formatVal} vs período anterior`;

            if (value === 0) {
                badge.className = 'trend-badge neutral';
            } else if (goodDirection === 'up-good') {
                badge.className = value > 0 ? 'trend-badge up-good' : 'trend-badge down-bad';
            } else if (goodDirection === 'down-good') {
                badge.className = value < 0 ? 'trend-badge down-good' : 'trend-badge up-bad';
            }
        }
        container.appendChild(badge);
    },

    renderMultipleBadges(containerId, mainValue, comparacaoArr, propKey, goodDirection) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        comparacaoArr.forEach(v => {
            if (v.matricula === this.activeVehicleMatricula) return;

            const badge = document.createElement('span');
            badge.style.display = 'block';
            badge.style.marginBottom = '4px';
            
            const compValue = v.totais[propKey];
            let diff = 0;
            if (compValue > 0) {
                diff = ((mainValue - compValue) / compValue) * 100;
            } else if (mainValue > 0) {
                diff = 100; // se comp=0 mas main>0, é 100% mais
            }

            const formatDiff = diff > 0 ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`;
            const absoluteVal = propKey === 'distancia_km' ? `${compValue} Km` : (propKey === 'custo_euros' ? `${compValue} €` : `${compValue} L/100km`);

            badge.textContent = `vs ${v.nome} (${absoluteVal}): ${formatDiff}`;

            if (diff === 0) {
                badge.className = 'trend-badge neutral';
            } else if (goodDirection === 'up-good') {
                badge.className = diff > 0 ? 'trend-badge up-good' : 'trend-badge down-bad';
            } else if (goodDirection === 'down-good') {
                badge.className = diff < 0 ? 'trend-badge down-good' : 'trend-badge up-bad';
            }
            container.appendChild(badge);
        });
    },

    renderChartsMulti(veiculosData) {
        const bgColors = ['rgba(59, 130, 246, 0.1)', 'rgba(16, 185, 129, 0.1)', 'rgba(245, 158, 11, 0.1)', 'rgba(239, 68, 68, 0.1)'];
        const borderColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

        const consumosDatasets = veiculosData.map((v, i) => {
            return {
                label: `${v.nome}`,
                data: v.cronologia.map(c => ({ x: new Date(c.data), y: c.consumo_l_100km })),
                borderColor: borderColors[i % borderColors.length],
                backgroundColor: bgColors[i % bgColors.length],
                borderWidth: 2,
                fill: false,
                tension: 0.3
            };
        });

        const custosDatasets = veiculosData.map((v, i) => {
            return {
                label: `${v.nome}`,
                data: v.cronologia.map(c => ({ x: new Date(c.data), y: c.custo_por_km })),
                borderColor: borderColors[i % borderColors.length],
                backgroundColor: bgColors[i % bgColors.length],
                borderWidth: 2,
                fill: false,
                tension: 0.3
            };
        });

        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: veiculosData.length > 1, labels: { color: '#94a3b8' } }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day',
                        displayFormats: { day: 'dd/MM/yyyy' }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                }
            }
        };

        if (this.charts.consumo) this.charts.consumo.destroy();
        const ctxConsumo = document.getElementById('chart-consumo').getContext('2d');
        this.charts.consumo = new Chart(ctxConsumo, { type: 'line', data: { datasets: consumosDatasets }, options: chartOptions });

        if (this.charts.custo) this.charts.custo.destroy();
        const ctxCusto = document.getElementById('chart-custo').getContext('2d');
        this.charts.custo = new Chart(ctxCusto, { type: 'line', data: { datasets: custosDatasets }, options: chartOptions });
    },

    async populateCompVeiculos(currentMatricula) {
        const select = document.getElementById('comp-veiculos');
        select.innerHTML = '';
        
        if (this.veiculos.length === 0) {
            await this.loadVeiculos();
        }

        this.veiculos.forEach(v => {
            if (v.matricula !== currentMatricula) {
                const opt = document.createElement('option');
                opt.value = v.matricula;
                opt.textContent = `${v.matricula} - ${v.nome}`;
                // Keep selection if previously selected
                if (this.veiculosComparacaoAtivos.includes(v.matricula)) opt.selected = true;
                select.appendChild(opt);
            }
        });
        
        if (!this.datasComparacao.inicio) {
            this.setCompPeriodo(30);
        } else {
            document.getElementById('comp-data-inicio').value = this.datasComparacao.inicio;
            document.getElementById('comp-data-fim').value = this.datasComparacao.fim;
        }
    },

    setCompPeriodo(dias) {
        const fim = new Date();
        const inicio = new Date();
        inicio.setDate(fim.getDate() - dias);

        document.getElementById('comp-data-inicio').value = inicio.toISOString().split('T')[0];
        document.getElementById('comp-data-fim').value = fim.toISOString().split('T')[0];
    },

    aplicarComparacao(e) {
        e.preventDefault();
        const select = document.getElementById('comp-veiculos');
        const options = Array.from(select.selectedOptions);
        
        const dataInicio = document.getElementById('comp-data-inicio').value;
        const dataFim = document.getElementById('comp-data-fim').value;

        if (options.length > 0) {
            this.veiculosComparacaoAtivos = options.map(o => o.value);
            this.datasComparacao = { inicio: dataInicio, fim: dataFim };
            
            // Atualizar indicator na interface
            const container = document.getElementById('active-comparisons');
            container.innerHTML = '';
            options.forEach(o => {
                const badge = document.createElement('span');
                badge.className = 'trend-badge neutral';
                badge.style.background = 'rgba(59, 130, 246, 0.2)';
                badge.style.color = '#fff';
                badge.textContent = o.text.split(' - ')[0]; // Só a matrícula no badge para poupar espaço
                container.appendChild(badge);
            });

            const clearBtn = document.createElement('button');
            clearBtn.className = 'btn btn-secondary';
            clearBtn.style.padding = '2px 8px';
            clearBtn.style.fontSize = '0.8rem';
            clearBtn.style.height = 'auto';
            clearBtn.innerHTML = '<i class="bx bx-x"></i> Limpar';
            clearBtn.onclick = () => this.limparComparacao(false);
            container.appendChild(clearBtn);
        } else {
            this.limparComparacao(false);
            return;
        }

        this.closeModal('modal-comparacao');
        this.loadVehicleDetails(this.activeVehicleMatricula);
    },

    limparComparacao(fecharModal = true) {
        this.veiculosComparacaoAtivos = [];
        this.datasComparacao = { inicio: null, fim: null };
        document.getElementById('active-comparisons').innerHTML = '';
        Array.from(document.getElementById('comp-veiculos').options).forEach(o => o.selected = false);
        this.setCompPeriodo(30);
        
        if (fecharModal) this.closeModal('modal-comparacao');
        this.loadVehicleDetails(this.activeVehicleMatricula);
    },

    // ==========================================
    // LOGS
    // ==========================================
    async loadLogs() {
        try {
            const data = await this.apiCall('/logs?limite=30');
            const tbody = document.querySelector('#tabela-logs tbody');
            tbody.innerHTML = '';

            data.logs.forEach(l => {
                const tr = document.createElement('tr');
                const dataFormatada = new Date(l.timestamp).toLocaleString('pt-PT');
                let statusColor = l.status >= 400 ? 'var(--danger-color)' : 'var(--success-color)';
                
                tr.innerHTML = `
                    <td>${dataFormatada}</td>
                    <td><strong>${l.metodo}</strong></td>
                    <td>${l.url}</td>
                    <td style="color: ${statusColor}; font-weight: bold;">${l.status}</td>
                    <td>${l.latencia_ms} ms</td>
                    <td>${l.ip}</td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) {}
    },

    // ==========================================
    // UTILS
    // ==========================================
    showModal(id) {
        document.getElementById(id).classList.add('active');
        if (id === 'modal-viagem') {
            const select = document.getElementById('select-veiculo-viagens');
            document.getElementById('vi-matricula').value = select.value || '';
        }
    },
    
    closeModal(id) {
        document.getElementById(id).classList.remove('active');
    },

    showToast(msg, type = 'success') {
        const toast = document.getElementById('toast');
        const span = document.getElementById('toast-msg');
        toast.className = `toast glass-panel ${type}`;
        span.textContent = msg;
        
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => app.init());
