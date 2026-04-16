/* ========================================
   FraudShield AI — Application Logic
   ======================================== */

(function () {
    'use strict';

    // ===================== Currency =====================
    const USD_TO_INR = 83.5;

    function formatINR(num, decimals) {
        decimals = typeof decimals === 'number' ? decimals : 0;
        const isNeg = num < 0;
        num = Math.abs(num);
        const parts = num.toFixed(decimals).split('.');
        let intPart = parts[0];
        const decPart = parts[1] ? '.' + parts[1] : '';
        // Indian grouping: last 3 digits, then groups of 2
        if (intPart.length > 3) {
            const last3 = intPart.slice(-3);
            const remaining = intPart.slice(0, -3);
            const grouped = remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
            intPart = grouped + ',' + last3;
        }
        return (isNeg ? '-' : '') + '₹' + intPart + decPart;
    }

    // ===================== State =====================
    const state = {
        rawData: [],
        analyzedData: [],
        filteredData: [],
        currentPage: 1,
        pageSize: 15,
        sortField: 'fraud_score',
        sortDir: 'desc',
        charts: {}
    };

    // ===================== DOM Refs =====================
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const dom = {
        navLinks: $$('.navbar__link'),
        sections: $$('.section'),
        uploadZone: $('#upload-zone'),
        fileInput: $('#file-input'),
        uploadProgress: $('#upload-progress'),
        progressFill: $('#progress-fill'),
        progressText: $('#progress-text'),
        btnSample: $('#btn-sample-data'),
        dataStatus: $('#data-status'),
        // KPI
        kpiTotal: $('#kpi-total-val'),
        kpiFlagged: $('#kpi-flagged-val'),
        kpiRisk: $('#kpi-risk-val'),
        kpiAmount: $('#kpi-amount-val'),
        // Filters
        filterRisk: $('#filter-risk'),
        filterLocation: $('#filter-location'),
        filterAmount: $('#filter-amount'),
        filterSearch: $('#filter-search'),
        btnClearFilters: $('#btn-clear-filters'),
        btnSortRisk: $('#btn-sort-risk'),
        resultsCount: $('#results-count'),
        // Table
        tableBody: $('#table-body'),
        // Pagination
        btnPrev: $('#btn-prev'),
        btnNext: $('#btn-next'),
        paginationPages: $('#pagination-pages'),
        // Modal
        modalOverlay: $('#modal-overlay'),
        modalTitle: $('#modal-title'),
        modalBody: $('#modal-body'),
        modalClose: $('#modal-close'),
        // Reports
        btnExportCSV: $('#btn-export-csv'),
        btnExportPDF: $('#btn-export-pdf'),
        btnExportFlagged: $('#btn-export-flagged'),
        reportPreviewBody: $('#report-preview-body'),
        // Insights
        insightsBody: $('#insights-body')
    };

    // ===================== Navigation =====================
    function initNavigation() {
        dom.navLinks.forEach(link => {
            link.addEventListener('click', () => {
                const section = link.dataset.section;
                switchSection(section);
            });
        });
    }

    function switchSection(sectionId) {
        dom.navLinks.forEach(l => l.classList.remove('navbar__link--active'));
        dom.sections.forEach(s => s.classList.remove('section--active'));

        const link = $(`[data-section="${sectionId}"]`);
        const section = $(`#section-${sectionId}`);
        if (link) link.classList.add('navbar__link--active');
        if (section) section.classList.add('section--active');
    }

    // ===================== File Upload =====================
    function initUpload() {
        const zone = dom.uploadZone;
        const inner = zone.querySelector('.upload-zone__inner');

        inner.addEventListener('click', () => dom.fileInput.click());

        dom.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) handleFile(e.target.files[0]);
        });

        // Drag & drop
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('upload-zone--dragging');
        });
        zone.addEventListener('dragleave', () => {
            zone.classList.remove('upload-zone--dragging');
        });
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('upload-zone--dragging');
            if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
        });

        dom.btnSample.addEventListener('click', loadSampleData);
    }

    function handleFile(file) {
        if (!file.name.endsWith('.csv')) {
            showToast('Please upload a CSV file', 'error');
            return;
        }

        showProgress('Reading file...');

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const csvText = e.target.result;
                const parsed = parseCSV(csvText);
                if (parsed.length === 0) {
                    showToast('No valid data found in CSV', 'error');
                    hideProgress();
                    return;
                }
                processData(parsed);
            } catch (err) {
                showToast('Error parsing CSV: ' + err.message, 'error');
                hideProgress();
            }
        };
        reader.readAsText(file);
    }

    function showProgress(text) {
        dom.uploadProgress.classList.add('upload-zone__progress--active');
        dom.progressText.textContent = text;
        dom.progressFill.style.width = '0%';
    }

    function hideProgress() {
        dom.uploadProgress.classList.remove('upload-zone__progress--active');
    }

    function animateProgress(callback) {
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 15 + 5;
            if (progress >= 100) {
                progress = 100;
                dom.progressFill.style.width = '100%';
                dom.progressText.textContent = 'Analysis complete!';
                clearInterval(interval);
                setTimeout(callback, 400);
            } else {
                dom.progressFill.style.width = progress + '%';
                if (progress < 40) dom.progressText.textContent = 'Parsing transactions...';
                else if (progress < 70) dom.progressText.textContent = 'Running fraud detection...';
                else dom.progressText.textContent = 'Generating explanations...';
            }
        }, 120);
    }

    // ===================== CSV Parser =====================
    function parseCSV(text) {
        const lines = text.trim().split(/\r?\n/);
        if (lines.length < 2) return [];

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
        const rows = [];

        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            if (values.length !== headers.length) continue;

            const row = {};
            headers.forEach((h, idx) => {
                row[h] = values[idx].trim();
            });
            rows.push(row);
        }
        return rows;
    }

    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current);
        return result;
    }

    // ===================== Fraud Detection Engine =====================
    function analyzeTransaction(txn, allTransactions) {
        const factors = [];
        let score = 0;

        const amount = (parseFloat(txn.amount) || 0) * USD_TO_INR;
        const userAvg = (parseFloat(txn.user_avg_amount) || parseFloat(txn.avg_amount) || 0) * USD_TO_INR;
        const location = (txn.location || '').trim();
        const homeLocation = (txn.user_home_location || txn.home_location || '').trim();
        const timeStr = txn.time || txn.timestamp || txn.date || '';

        // Factor 1: High transaction amount (absolute)
        if (amount > 400000) {
            score += 25;
            factors.push({ type: 'high-amount', label: 'Very High Amount', desc: `Transaction amount (${formatINR(amount)}) exceeds ₹4,00,000 threshold.`, weight: 25 });
        } else if (amount > 150000) {
            score += 15;
            factors.push({ type: 'high-amount', label: 'High Amount', desc: `Transaction amount (${formatINR(amount)}) exceeds ₹1,50,000 threshold.`, weight: 15 });
        } else if (amount > 80000) {
            score += 8;
            factors.push({ type: 'high-amount', label: 'Elevated Amount', desc: `Transaction amount (${formatINR(amount)}) exceeds ₹80,000 threshold.`, weight: 8 });
        }

        // Factor 2: Deviation from user average
        if (userAvg > 0) {
            const ratio = amount / userAvg;
            if (ratio > 5) {
                score += 30;
                factors.push({ type: 'behavior', label: 'Extreme Deviation', desc: `Amount is ${ratio.toFixed(1)}x the user's average (${formatINR(userAvg, 2)}). This is a significant behavioral anomaly.`, weight: 30 });
            } else if (ratio > 3) {
                score += 20;
                factors.push({ type: 'behavior', label: 'High Deviation', desc: `Amount is ${ratio.toFixed(1)}x the user's average (${formatINR(userAvg, 2)}), indicating unusual spending behavior.`, weight: 20 });
            } else if (ratio > 2) {
                score += 10;
                factors.push({ type: 'behavior', label: 'Moderate Deviation', desc: `Amount is ${ratio.toFixed(1)}x the user's average (${formatINR(userAvg, 2)}).`, weight: 10 });
            }
        }

        // Factor 3: Location mismatch
        if (location && homeLocation && location.toLowerCase() !== homeLocation.toLowerCase()) {
            score += 20;
            factors.push({ type: 'new-location', label: 'New Location', desc: `Transaction in "${location}" differs from user's home location "${homeLocation}".`, weight: 20 });
        }

        // Factor 4: Unusual time
        if (timeStr) {
            const hour = extractHour(timeStr);
            if (hour !== null) {
                if (hour >= 0 && hour < 5) {
                    score += 20;
                    factors.push({ type: 'unusual-time', label: 'Late Night Activity', desc: `Transaction at ${formatHour(hour)} falls within high-risk hours (12 AM – 5 AM).`, weight: 20 });
                } else if (hour >= 22 || hour === 5) {
                    score += 10;
                    factors.push({ type: 'unusual-time', label: 'Off-Hours Activity', desc: `Transaction at ${formatHour(hour)} is outside typical business hours.`, weight: 10 });
                }
            }
        }

        // Factor 5: Merchant risk (heuristic — certain patterns are riskier)
        const merchant = (txn.merchant || '').toLowerCase();
        const riskyMerchants = ['wire transfer', 'crypto', 'bitcoin', 'forex', 'western union', 'moneygram', 'casino', 'gambling', 'offshore'];
        const matchedRisky = riskyMerchants.find(rm => merchant.includes(rm));
        if (matchedRisky) {
            score += 15;
            factors.push({ type: 'behavior', label: 'High-Risk Merchant', desc: `Merchant category "${txn.merchant}" is associated with elevated fraud risk.`, weight: 15 });
        }

        // Normalize score to max 100
        score = Math.min(score, 100);

        // Add small random variance for realism
        if (score > 0 && score < 100) {
            score = Math.min(100, Math.max(0, score + Math.floor(Math.random() * 6 - 3)));
        }

        // Generate explanation
        const explanation = generateExplanation(txn, factors, score);

        return {
            ...txn,
            amount: amount,
            fraud_score: score,
            risk_level: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low',
            factors: factors,
            explanation: explanation
        };
    }

    function extractHour(timeStr) {
        // Try various time formats
        const match = timeStr.match(/(\d{1,2}):(\d{2})/);
        if (match) return parseInt(match[1], 10);

        const dateObj = new Date(timeStr);
        if (!isNaN(dateObj.getTime())) return dateObj.getHours();

        return null;
    }

    function formatHour(h) {
        if (h === 0) return '12:00 AM';
        if (h < 12) return h + ':00 AM';
        if (h === 12) return '12:00 PM';
        return (h - 12) + ':00 PM';
    }

    function generateExplanation(txn, factors, score) {
        if (factors.length === 0) {
            return 'This transaction appears normal. No significant risk factors were detected.';
        }

        const parts = [];
        parts.push(`This transaction has been flagged with a ${score}% fraud probability.`);

        factors.forEach(f => {
            parts.push(f.desc);
        });

        if (score >= 70) {
            parts.push('Recommended action: Immediate review by compliance team.');
        } else if (score >= 40) {
            parts.push('Recommended action: Add to watchlist for additional monitoring.');
        }

        return parts.join(' ');
    }

    // ===================== Data Processing =====================
    function processData(rawData) {
        showProgress('Analyzing...');
        state.rawData = rawData;

        animateProgress(() => {
            state.analyzedData = rawData.map(txn => analyzeTransaction(txn, rawData));
            state.filteredData = [...state.analyzedData];
            state.currentPage = 1;

            // Sort by fraud score desc by default
            state.filteredData.sort((a, b) => b.fraud_score - a.fraud_score);

            updateDataStatus();
            populateFilters();
            renderDashboard();
            renderTable();
            renderReportPreview();
            enableExportButtons();

            hideProgress();
            showToast(`Successfully analyzed ${state.analyzedData.length} transactions`, 'success');

            // Switch to dashboard
            switchSection('dashboard');
        });
    }

    function updateDataStatus() {
        dom.dataStatus.textContent = `${state.analyzedData.length} transactions loaded`;
        dom.dataStatus.classList.add('navbar__status--active');
    }

    // ===================== Dashboard =====================
    function renderDashboard() {
        const data = state.analyzedData;
        const flagged = data.filter(d => d.fraud_score >= 40);
        const highRisk = data.filter(d => d.fraud_score >= 70);
        const totalAtRisk = flagged.reduce((sum, d) => sum + d.amount, 0);
        const fraudRate = data.length > 0 ? ((flagged.length / data.length) * 100).toFixed(1) : 0;

        // Animate KPI values
        animateNumber(dom.kpiTotal, 0, data.length, 800);
        animateNumber(dom.kpiFlagged, 0, flagged.length, 800);
        dom.kpiRisk.textContent = fraudRate + '%';
        dom.kpiAmount.textContent = formatINR(totalAtRisk);

        renderCharts(data);
        renderInsights(data, flagged, highRisk);
    }

    function animateNumber(el, from, to, duration) {
        const start = performance.now();
        const animate = (now) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
            if (progress < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    // ===================== Charts =====================
    function renderCharts(data) {
        // Destroy existing charts
        Object.values(state.charts).forEach(c => c.destroy());
        state.charts = {};

        const chartDefaults = {
            color: '#8a8ea8',
            borderColor: 'rgba(255,255,255,0.06)',
            font: { family: "'Inter', sans-serif" }
        };

        Chart.defaults.color = chartDefaults.color;
        Chart.defaults.borderColor = chartDefaults.borderColor;
        Chart.defaults.font.family = chartDefaults.font.family;

        renderDistributionChart(data);
        renderRiskChart(data);
        renderFactorsChart(data);
        renderTimelineChart(data);
    }

    function renderDistributionChart(data) {
        const high = data.filter(d => d.risk_level === 'high').length;
        const medium = data.filter(d => d.risk_level === 'medium').length;
        const low = data.filter(d => d.risk_level === 'low').length;

        const ctx = $('#chart-distribution').getContext('2d');
        state.charts.distribution = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['High Risk', 'Medium Risk', 'Low Risk'],
                datasets: [{
                    data: [high, medium, low],
                    backgroundColor: [
                        'rgba(239, 68, 68, 0.8)',
                        'rgba(245, 158, 11, 0.8)',
                        'rgba(34, 197, 94, 0.8)'
                    ],
                    borderColor: [
                        'rgba(239, 68, 68, 1)',
                        'rgba(245, 158, 11, 1)',
                        'rgba(34, 197, 94, 1)'
                    ],
                    borderWidth: 2,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { padding: 16, usePointStyle: true, pointStyleWidth: 8 }
                    }
                }
            }
        });
    }

    function renderRiskChart(data) {
        const bins = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 0-9, 10-19, ..., 90-100
        data.forEach(d => {
            const bin = Math.min(Math.floor(d.fraud_score / 10), 9);
            bins[bin]++;
        });

        const ctx = $('#chart-risk').getContext('2d');
        state.charts.risk = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['0-9%', '10-19%', '20-29%', '30-39%', '40-49%', '50-59%', '60-69%', '70-79%', '80-89%', '90-100%'],
                datasets: [{
                    label: 'Transactions',
                    data: bins,
                    backgroundColor: bins.map((_, i) => {
                        if (i < 4) return 'rgba(34, 197, 94, 0.6)';
                        if (i < 7) return 'rgba(245, 158, 11, 0.6)';
                        return 'rgba(239, 68, 68, 0.6)';
                    }),
                    borderColor: bins.map((_, i) => {
                        if (i < 4) return 'rgba(34, 197, 94, 1)';
                        if (i < 7) return 'rgba(245, 158, 11, 1)';
                        return 'rgba(239, 68, 68, 1)';
                    }),
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false } },
                    y: { beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });
    }

    function renderFactorsChart(data) {
        const factorCounts = {};
        data.forEach(d => {
            d.factors.forEach(f => {
                factorCounts[f.label] = (factorCounts[f.label] || 0) + 1;
            });
        });

        const sorted = Object.entries(factorCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
        const labels = sorted.map(s => s[0]);
        const values = sorted.map(s => s[1]);

        const ctx = $('#chart-factors').getContext('2d');
        state.charts.factors = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Occurrences',
                    data: values,
                    backgroundColor: 'rgba(99, 102, 241, 0.5)',
                    borderColor: 'rgba(99, 102, 241, 1)',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, ticks: { stepSize: 1 } },
                    y: { grid: { display: false } }
                }
            }
        });
    }

    function renderTimelineChart(data) {
        const hourBuckets = new Array(24).fill(0);
        const hourFraud = new Array(24).fill(0);

        data.forEach(d => {
            const timeStr = d.time || d.timestamp || d.date || '';
            const h = extractHour(timeStr);
            if (h !== null) {
                hourBuckets[h]++;
                if (d.fraud_score >= 40) hourFraud[h]++;
            }
        });

        const labels = Array.from({ length: 24 }, (_, i) => {
            if (i === 0) return '12 AM';
            if (i < 12) return i + ' AM';
            if (i === 12) return '12 PM';
            return (i - 12) + ' PM';
        });

        const ctx = $('#chart-timeline').getContext('2d');
        state.charts.timeline = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'All Transactions',
                        data: hourBuckets,
                        borderColor: 'rgba(99, 102, 241, 0.8)',
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 6
                    },
                    {
                        label: 'Flagged',
                        data: hourFraud,
                        borderColor: 'rgba(239, 68, 68, 0.8)',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } }
                },
                scales: {
                    x: { grid: { display: false } },
                    y: { beginAtZero: true }
                }
            }
        });
    }

    // ===================== Insights =====================
    function renderInsights(data, flagged, highRisk) {
        const insights = [];

        // Insight 1: Fraud rate
        const fraudRate = ((flagged.length / data.length) * 100).toFixed(1);
        if (fraudRate > 20) {
            insights.push({ icon: '🚨', type: 'danger', title: `High fraud rate detected: ${fraudRate}%`, desc: `${flagged.length} of ${data.length} transactions are flagged. This is significantly above the industry average of 5-10%. Immediate investigation recommended.` });
        } else if (fraudRate > 10) {
            insights.push({ icon: '⚠️', type: 'warning', title: `Elevated fraud rate: ${fraudRate}%`, desc: `${flagged.length} of ${data.length} transactions are flagged. Consider reviewing the below risk factors for patterns.` });
        } else {
            insights.push({ icon: 'ℹ️', type: 'info', title: `Fraud rate within normal range: ${fraudRate}%`, desc: `${flagged.length} of ${data.length} transactions are flagged. Continue routine monitoring.` });
        }

        // Insight 2: Top risky location
        const locCounts = {};
        flagged.forEach(d => {
            const loc = d.location || 'Unknown';
            locCounts[loc] = (locCounts[loc] || 0) + 1;
        });
        const topLoc = Object.entries(locCounts).sort((a, b) => b[1] - a[1])[0];
        if (topLoc) {
            insights.push({ icon: '📍', type: 'warning', title: `Highest risk location: ${topLoc[0]}`, desc: `${topLoc[1]} flagged transaction(s) originated from "${topLoc[0]}". Consider geo-blocking or enhanced verification for this region.` });
        }

        // Insight 3: High-value at risk
        const highValueFlagged = flagged.filter(d => d.amount > 80000);
        if (highValueFlagged.length > 0) {
            const totalHV = highValueFlagged.reduce((s, d) => s + d.amount, 0);
            insights.push({ icon: '💰', type: 'danger', title: `${highValueFlagged.length} high-value transactions flagged`, desc: `${formatINR(totalHV)} in transactions over ₹80,000 are considered at risk. Prioritize these for manual review.` });
        }

        // Insight 4: Late night activity
        const lateNight = flagged.filter(d => {
            const timeStr = d.time || d.timestamp || d.date || '';
            const h = extractHour(timeStr);
            return h !== null && (h >= 0 && h < 5);
        });
        if (lateNight.length > 0) {
            insights.push({ icon: '🌙', type: 'warning', title: `${lateNight.length} suspicious late-night transaction(s)`, desc: 'Transactions between 12 AM – 5 AM are historically correlated with higher fraud rates. Review these entries carefully.' });
        }

        // Insight 5: Location mismatch count
        const locationMismatch = flagged.filter(d => d.factors.some(f => f.type === 'new-location'));
        if (locationMismatch.length > 0) {
            insights.push({ icon: '🗺️', type: 'info', title: `${locationMismatch.length} location mismatches detected`, desc: 'These transactions were made from locations different from user home locations. Could indicate account compromise or travel.' });
        }

        let html = '';
        insights.forEach(ins => {
            html += `
                <div class="insight-item">
                    <div class="insight-item__icon insight-item__icon--${ins.type}">${ins.icon}</div>
                    <div class="insight-item__content">
                        <div class="insight-item__title">${ins.title}</div>
                        <div class="insight-item__desc">${ins.desc}</div>
                    </div>
                </div>
            `;
        });
        dom.insightsBody.innerHTML = html;
    }

    // ===================== Filters =====================
    function populateFilters() {
        // Populate location filter
        const locations = [...new Set(state.analyzedData.map(d => d.location || 'Unknown'))].sort();
        dom.filterLocation.innerHTML = '<option value="all">All Locations</option>';
        locations.forEach(loc => {
            dom.filterLocation.innerHTML += `<option value="${escapeHtml(loc)}">${escapeHtml(loc)}</option>`;
        });
    }

    function initFilters() {
        dom.filterRisk.addEventListener('change', applyFilters);
        dom.filterLocation.addEventListener('change', applyFilters);
        dom.filterAmount.addEventListener('change', applyFilters);
        dom.filterSearch.addEventListener('input', debounce(applyFilters, 300));
        dom.btnClearFilters.addEventListener('click', clearFilters);
        dom.btnSortRisk.addEventListener('click', toggleSortRisk);
    }

    function applyFilters() {
        let data = [...state.analyzedData];

        // Risk level
        const risk = dom.filterRisk.value;
        if (risk === 'high') data = data.filter(d => d.fraud_score >= 70);
        else if (risk === 'medium') data = data.filter(d => d.fraud_score >= 40 && d.fraud_score < 70);
        else if (risk === 'low') data = data.filter(d => d.fraud_score < 40);

        // Location
        const loc = dom.filterLocation.value;
        if (loc !== 'all') data = data.filter(d => (d.location || 'Unknown') === loc);

        // Amount range
        const amt = dom.filterAmount.value;
        if (amt !== 'all') {
            const [min, max] = amt.includes('+') ? [parseFloat(amt), Infinity] : amt.split('-').map(Number);
            data = data.filter(d => d.amount >= min && d.amount <= (max || Infinity));
        }

        // Search
        const search = dom.filterSearch.value.toLowerCase().trim();
        if (search) {
            data = data.filter(d =>
                (d.transaction_id || '').toLowerCase().includes(search) ||
                (d.merchant || '').toLowerCase().includes(search) ||
                (d.location || '').toLowerCase().includes(search) ||
                (d.user_id || '').toLowerCase().includes(search)
            );
        }

        // Apply sort
        data.sort((a, b) => {
            const aVal = a[state.sortField];
            const bVal = b[state.sortField];
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return state.sortDir === 'desc' ? bVal - aVal : aVal - bVal;
            }
            return state.sortDir === 'desc'
                ? String(bVal).localeCompare(String(aVal))
                : String(aVal).localeCompare(String(bVal));
        });

        state.filteredData = data;
        state.currentPage = 1;
        renderTable();
    }

    function clearFilters() {
        dom.filterRisk.value = 'all';
        dom.filterLocation.value = 'all';
        dom.filterAmount.value = 'all';
        dom.filterSearch.value = '';
        applyFilters();
    }

    function toggleSortRisk() {
        state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
        dom.btnSortRisk.querySelector('svg').style.transform = state.sortDir === 'asc' ? 'rotate(180deg)' : '';
        applyFilters();
    }

    // ===================== Table Rendering =====================
    function renderTable() {
        const data = state.filteredData;
        const start = (state.currentPage - 1) * state.pageSize;
        const end = start + state.pageSize;
        const page = data.slice(start, end);

        dom.resultsCount.textContent = `${data.length} transaction${data.length !== 1 ? 's' : ''} found`;

        if (page.length === 0) {
            dom.tableBody.innerHTML = `
                <tr class="data-table__empty-row">
                    <td colspan="8">
                        <div class="data-table__empty">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <p>No transactions match your filters.</p>
                        </div>
                    </td>
                </tr>
            `;
            renderPagination(0);
            return;
        }

        let html = '';
        page.forEach((txn, idx) => {
            const rowClass = txn.risk_level === 'high' ? 'data-table__row--high-risk'
                : txn.risk_level === 'medium' ? 'data-table__row--medium-risk' : '';

            const riskTags = txn.factors.slice(0, 3).map(f =>
                `<span class="risk-tag risk-tag--${f.type}">${escapeHtml(f.label)}</span>`
            ).join('');

            html += `
                <tr class="data-table__row ${rowClass}" data-index="${start + idx}">
                    <td><strong>${escapeHtml(txn.transaction_id || txn.id || `TXN${start + idx + 1}`)}</strong></td>
                    <td>${formatINR(txn.amount, 2)}</td>
                    <td>${escapeHtml(txn.merchant || 'N/A')}</td>
                    <td>${escapeHtml(txn.location || 'N/A')}</td>
                    <td>${escapeHtml(txn.time || txn.timestamp || txn.date || 'N/A')}</td>
                    <td><span class="score-badge score-badge--${txn.risk_level}">${txn.fraud_score}%</span></td>
                    <td><div class="risk-tags">${riskTags || '<span class="risk-tag">None</span>'}</div></td>
                    <td><button class="btn-detail" onclick="window.showDetail(${start + idx})">Inspect</button></td>
                </tr>
            `;
        });

        dom.tableBody.innerHTML = html;
        renderPagination(data.length);
    }

    // ===================== Pagination =====================
    function renderPagination(total) {
        const totalPages = Math.ceil(total / state.pageSize);

        dom.btnPrev.disabled = state.currentPage <= 1;
        dom.btnNext.disabled = state.currentPage >= totalPages;

        let html = '';
        const maxShow = 7;
        let startPage = Math.max(1, state.currentPage - Math.floor(maxShow / 2));
        let endPage = Math.min(totalPages, startPage + maxShow - 1);
        if (endPage - startPage < maxShow - 1) startPage = Math.max(1, endPage - maxShow + 1);

        for (let i = startPage; i <= endPage; i++) {
            html += `<button class="pagination__page ${i === state.currentPage ? 'pagination__page--active' : ''}" data-page="${i}">${i}</button>`;
        }
        dom.paginationPages.innerHTML = html;

        // Page click handlers
        dom.paginationPages.querySelectorAll('.pagination__page').forEach(btn => {
            btn.addEventListener('click', () => {
                state.currentPage = parseInt(btn.dataset.page);
                renderTable();
                scrollToTable();
            });
        });
    }

    function initPagination() {
        dom.btnPrev.addEventListener('click', () => {
            if (state.currentPage > 1) {
                state.currentPage--;
                renderTable();
                scrollToTable();
            }
        });
        dom.btnNext.addEventListener('click', () => {
            const totalPages = Math.ceil(state.filteredData.length / state.pageSize);
            if (state.currentPage < totalPages) {
                state.currentPage++;
                renderTable();
                scrollToTable();
            }
        });
    }

    function scrollToTable() {
        const el = $('#table-wrap');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ===================== Modal / Detail View =====================
    function initModal() {
        dom.modalClose.addEventListener('click', closeModal);
        dom.modalOverlay.addEventListener('click', (e) => {
            if (e.target === dom.modalOverlay) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });
    }

    window.showDetail = function (index) {
        const txn = state.filteredData[index];
        if (!txn) return;

        dom.modalTitle.textContent = `Transaction ${txn.transaction_id || txn.id || 'Details'}`;

        const riskColor = txn.risk_level === 'high' ? 'high' : txn.risk_level === 'medium' ? 'medium' : 'low';

        const factorsHtml = txn.factors.map(f => `
            <div style="display:flex; align-items:flex-start; gap:8px; margin-bottom:8px;">
                <span class="risk-tag risk-tag--${f.type}" style="margin-top:2px;">${escapeHtml(f.label)}</span>
                <span style="font-size:0.8125rem; color:#8a8ea8;">${escapeHtml(f.desc)}</span>
            </div>
        `).join('');

        dom.modalBody.innerHTML = `
            <div class="modal-detail">
                <div class="modal-detail__section">
                    <div class="modal-detail__section-title">Fraud Risk Assessment</div>
                    <div style="display:flex; align-items:center; gap:16px; margin-bottom:8px;">
                        <span class="score-badge score-badge--${txn.risk_level}" style="font-size:1.5rem; padding:8px 20px;">${txn.fraud_score}%</span>
                        <span style="font-size:0.875rem; color:#8a8ea8; text-transform:uppercase; font-weight:600;">${txn.risk_level} Risk</span>
                    </div>
                    <div class="modal-detail__risk-meter">
                        <div class="modal-detail__risk-fill modal-detail__risk-fill--${riskColor}" style="width:${txn.fraud_score}%"></div>
                    </div>
                </div>

                <div class="modal-detail__section">
                    <div class="modal-detail__section-title">Transaction Information</div>
                    <div class="modal-detail__grid">
                        <div class="modal-detail__field">
                            <span class="modal-detail__label">Transaction ID</span>
                            <span class="modal-detail__value">${escapeHtml(txn.transaction_id || txn.id || 'N/A')}</span>
                        </div>
                        <div class="modal-detail__field">
                            <span class="modal-detail__label">Amount</span>
                            <span class="modal-detail__value">${formatINR(txn.amount, 2)}</span>
                        </div>
                        <div class="modal-detail__field">
                            <span class="modal-detail__label">Merchant</span>
                            <span class="modal-detail__value">${escapeHtml(txn.merchant || 'N/A')}</span>
                        </div>
                        <div class="modal-detail__field">
                            <span class="modal-detail__label">Location</span>
                            <span class="modal-detail__value">${escapeHtml(txn.location || 'N/A')}</span>
                        </div>
                        <div class="modal-detail__field">
                            <span class="modal-detail__label">Time</span>
                            <span class="modal-detail__value">${escapeHtml(txn.time || txn.timestamp || txn.date || 'N/A')}</span>
                        </div>
                        <div class="modal-detail__field">
                            <span class="modal-detail__label">User ID</span>
                            <span class="modal-detail__value">${escapeHtml(txn.user_id || 'N/A')}</span>
                        </div>
                        <div class="modal-detail__field">
                            <span class="modal-detail__label">User Avg Amount</span>
                            <span class="modal-detail__value">${formatINR(parseFloat(txn.user_avg_amount || txn.avg_amount || 0) * USD_TO_INR, 2)}</span>
                        </div>
                        <div class="modal-detail__field">
                            <span class="modal-detail__label">Home Location</span>
                            <span class="modal-detail__value">${escapeHtml(txn.user_home_location || txn.home_location || 'N/A')}</span>
                        </div>
                    </div>
                </div>

                <div class="modal-detail__section">
                    <div class="modal-detail__section-title">Risk Factors (${txn.factors.length})</div>
                    ${factorsHtml || '<p style="color:#5a5e78;">No risk factors identified.</p>'}
                </div>

                <div class="modal-detail__section">
                    <div class="modal-detail__section-title">AI Explanation</div>
                    <div class="modal-detail__explanation">${escapeHtml(txn.explanation)}</div>
                </div>
            </div>
        `;

        dom.modalOverlay.classList.add('modal-overlay--active');
        document.body.style.overflow = 'hidden';
    };

    function closeModal() {
        dom.modalOverlay.classList.remove('modal-overlay--active');
        document.body.style.overflow = '';
    }

    // ===================== Reports =====================
    function enableExportButtons() {
        dom.btnExportCSV.disabled = false;
        dom.btnExportPDF.disabled = false;
        dom.btnExportFlagged.disabled = false;
    }

    function initReports() {
        dom.btnExportCSV.addEventListener('click', exportCSV);
        dom.btnExportPDF.addEventListener('click', exportPDF);
        dom.btnExportFlagged.addEventListener('click', exportFlaggedCSV);
    }

    function renderReportPreview() {
        const data = state.analyzedData;
        const flagged = data.filter(d => d.fraud_score >= 40);
        const highRisk = data.filter(d => d.fraud_score >= 70);
        const totalAmount = data.reduce((s, d) => s + d.amount, 0);
        const atRiskAmount = flagged.reduce((s, d) => s + d.amount, 0);

        dom.reportPreviewBody.innerHTML = `
            <div class="report-summary">
                <div class="report-summary__item">
                    <div class="report-summary__label">Report Date</div>
                    <div class="report-summary__value" style="font-size:1rem;">${new Date().toLocaleDateString()}</div>
                </div>
                <div class="report-summary__item">
                    <div class="report-summary__label">Total Transactions</div>
                    <div class="report-summary__value">${data.length.toLocaleString()}</div>
                </div>
                <div class="report-summary__item">
                    <div class="report-summary__label">Flagged Transactions</div>
                    <div class="report-summary__value" style="color:#f59e0b;">${flagged.length.toLocaleString()}</div>
                </div>
                <div class="report-summary__item">
                    <div class="report-summary__label">High Risk</div>
                    <div class="report-summary__value" style="color:#ef4444;">${highRisk.length.toLocaleString()}</div>
                </div>
                <div class="report-summary__item">
                    <div class="report-summary__label">Total Volume</div>
                    <div class="report-summary__value" style="font-size:1rem;">${formatINR(totalAmount)}</div>
                </div>
                <div class="report-summary__item">
                    <div class="report-summary__label">At-Risk Amount</div>
                    <div class="report-summary__value" style="font-size:1rem; color:#ef4444;">${formatINR(atRiskAmount)}</div>
                </div>
            </div>
        `;
    }

    function exportCSV() {
        const data = state.analyzedData;
        const headers = ['Transaction ID', 'Amount (INR)', 'Merchant', 'Location', 'Time', 'User ID', 'Fraud Score (%)', 'Risk Level', 'Risk Factors', 'Explanation'];

        let csv = headers.join(',') + '\n';
        data.forEach(d => {
            csv += [
                csvEscape(d.transaction_id || d.id || ''),
                d.amount,
                csvEscape(d.merchant || ''),
                csvEscape(d.location || ''),
                csvEscape(d.time || d.timestamp || d.date || ''),
                csvEscape(d.user_id || ''),
                d.fraud_score,
                d.risk_level,
                csvEscape(d.factors.map(f => f.label).join('; ')),
                csvEscape(d.explanation)
            ].join(',') + '\n';
        });

        downloadFile(csv, 'fraud_analysis_report.csv', 'text/csv');
        showToast('CSV report downloaded successfully', 'success');
    }

    function exportFlaggedCSV() {
        const data = state.analyzedData.filter(d => d.fraud_score >= 40);
        const headers = ['Transaction ID', 'Amount (INR)', 'Merchant', 'Location', 'Time', 'User ID', 'Fraud Score (%)', 'Risk Level', 'Risk Factors', 'Explanation'];

        let csv = headers.join(',') + '\n';
        data.forEach(d => {
            csv += [
                csvEscape(d.transaction_id || d.id || ''),
                d.amount,
                csvEscape(d.merchant || ''),
                csvEscape(d.location || ''),
                csvEscape(d.time || d.timestamp || d.date || ''),
                csvEscape(d.user_id || ''),
                d.fraud_score,
                d.risk_level,
                csvEscape(d.factors.map(f => f.label).join('; ')),
                csvEscape(d.explanation)
            ].join(',') + '\n';
        });

        downloadFile(csv, 'flagged_transactions_report.csv', 'text/csv');
        showToast(`Exported ${data.length} flagged transactions`, 'success');
    }

    function exportPDF() {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('landscape', 'mm', 'a4');

        const data = state.analyzedData;
        const flagged = data.filter(d => d.fraud_score >= 40);
        const highRisk = data.filter(d => d.fraud_score >= 70);

        // Title
        doc.setFontSize(22);
        doc.setTextColor(30, 30, 50);
        doc.text('FraudShield AI — Compliance Report', 14, 20);

        doc.setFontSize(10);
        doc.setTextColor(120, 120, 140);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);

        // Summary
        doc.setFontSize(14);
        doc.setTextColor(30, 30, 50);
        doc.text('Executive Summary', 14, 40);

        doc.setFontSize(10);
        doc.setTextColor(60, 60, 80);
        const summaryLines = [
            `Total Transactions Analyzed: ${data.length}`,
            `Flagged Transactions (≥40% risk): ${flagged.length} (${((flagged.length / data.length) * 100).toFixed(1)}%)`,
            `High Risk Transactions (≥70% risk): ${highRisk.length}`,
            `Total Transaction Volume: ${formatINR(data.reduce((s, d) => s + d.amount, 0))}`,
            `At-Risk Amount: ${formatINR(flagged.reduce((s, d) => s + d.amount, 0))}`
        ];
        summaryLines.forEach((line, i) => {
            doc.text(line, 14, 48 + i * 6);
        });

        // Flagged Transactions Table
        doc.setFontSize(14);
        doc.setTextColor(30, 30, 50);
        doc.text('Flagged Transactions Detail', 14, 84);

        const tableData = flagged.map(d => [
            d.transaction_id || d.id || '',
            formatINR(d.amount, 2),
            d.merchant || '',
            d.location || '',
            d.time || d.timestamp || d.date || '',
            `${d.fraud_score}%`,
            d.risk_level.toUpperCase(),
            d.factors.map(f => f.label).join(', ')
        ]);

        doc.autoTable({
            startY: 90,
            head: [['ID', 'Amount', 'Merchant', 'Location', 'Time', 'Score', 'Risk', 'Factors']],
            body: tableData,
            theme: 'grid',
            headStyles: { fillColor: [99, 102, 241], textColor: 255, fontSize: 8 },
            bodyStyles: { fontSize: 7 },
            columnStyles: {
                0: { cellWidth: 25 },
                5: { cellWidth: 15 },
                6: { cellWidth: 15 }
            },
            didParseCell: function (data) {
                if (data.section === 'body' && data.column.index === 6) {
                    const val = data.cell.raw;
                    if (val === 'HIGH') {
                        data.cell.styles.textColor = [239, 68, 68];
                        data.cell.styles.fontStyle = 'bold';
                    } else if (val === 'MEDIUM') {
                        data.cell.styles.textColor = [245, 158, 11];
                    }
                }
            },
            margin: { top: 20 }
        });

        // Footer
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150);
            doc.text(`FraudShield AI — Page ${i} of ${pageCount} — Confidential`, 14, doc.internal.pageSize.height - 10);
        }

        doc.save('fraud_compliance_report.pdf');
        showToast('PDF report downloaded successfully', 'success');
    }

    // ===================== Sample Data Generator =====================
    function loadSampleData() {
        showProgress('Generating sample data...');

        const merchants = [
            'Amazon', 'Walmart', 'Target', 'Best Buy', 'Starbucks', 'Shell Gas', 'Apple Store',
            'Netflix', 'Uber', 'Lyft', 'DoorDash', 'Home Depot', 'Costco', 'Whole Foods',
            'Nike', 'Adidas', 'Zara', 'H&M', 'Sephora', 'CVS Pharmacy',
            'Wire Transfer Co', 'Crypto Exchange', 'Western Union', 'Casino Royale', 'Forex Trading Ltd'
        ];

        const locations = [
            'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix',
            'San Francisco', 'Seattle', 'Denver', 'Miami', 'Boston',
            'Atlanta', 'Dallas', 'Las Vegas', 'Portland', 'Austin',
            'Lagos', 'Manila', 'Mumbai', 'Bucharest', 'São Paulo'
        ];

        const homeLocations = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'San Francisco', 'Seattle', 'Denver', 'Miami', 'Boston'];

        const users = [];
        for (let i = 1; i <= 40; i++) {
            users.push({
                id: `USR${String(i).padStart(3, '0')}`,
                avgAmount: 50 + Math.random() * 400,
                homeLocation: homeLocations[Math.floor(Math.random() * homeLocations.length)]
            });
        }

        const transactions = [];
        for (let i = 1; i <= 200; i++) {
            const user = users[Math.floor(Math.random() * users.length)];
            const isFraudulent = Math.random() < 0.25; // 25% fraud rate for demo

            let amount, merchant, location, hour;

            if (isFraudulent) {
                const fraudType = Math.random();
                if (fraudType < 0.3) {
                    // High amount fraud
                    amount = 2000 + Math.random() * 15000;
                    merchant = merchants[Math.floor(Math.random() * merchants.length)];
                    location = user.homeLocation;
                    hour = Math.floor(Math.random() * 24);
                } else if (fraudType < 0.5) {
                    // Foreign location + high amount
                    amount = 500 + Math.random() * 8000;
                    merchant = merchants[Math.floor(Math.random() * merchants.length)];
                    location = locations.filter(l => l !== user.homeLocation)[Math.floor(Math.random() * (locations.length - 1))];
                    hour = Math.floor(Math.random() * 5); // Late night
                } else if (fraudType < 0.7) {
                    // Late night + unusual merchant
                    amount = 100 + Math.random() * 3000;
                    merchant = merchants.slice(20)[Math.floor(Math.random() * 5)]; // Risky merchants
                    location = locations[Math.floor(Math.random() * locations.length)];
                    hour = Math.floor(Math.random() * 5);
                } else {
                    // Combined: foreign + high amount + late night
                    amount = 3000 + Math.random() * 12000;
                    merchant = merchants[Math.floor(Math.random() * merchants.length)];
                    location = locations.filter(l => l !== user.homeLocation)[Math.floor(Math.random() * (locations.length - 1))];
                    hour = Math.floor(Math.random() * 4);
                }
            } else {
                amount = user.avgAmount * (0.3 + Math.random() * 1.4);
                merchant = merchants.slice(0, 20)[Math.floor(Math.random() * 20)];
                location = Math.random() < 0.85 ? user.homeLocation : locations[Math.floor(Math.random() * locations.length)];
                hour = 8 + Math.floor(Math.random() * 12); // 8 AM - 8 PM
            }

            const day = Math.floor(Math.random() * 28) + 1;
            const month = Math.floor(Math.random() * 12) + 1;
            const minute = Math.floor(Math.random() * 60);

            transactions.push({
                transaction_id: `TXN${String(i).padStart(4, '0')}`,
                amount: amount.toFixed(2),
                merchant: merchant,
                location: location,
                time: `2024-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
                user_id: user.id,
                user_avg_amount: user.avgAmount.toFixed(2),
                user_home_location: user.homeLocation
            });
        }

        setTimeout(() => processData(transactions), 200);
    }

    // ===================== Utilities =====================
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function csvEscape(str) {
        if (!str) return '""';
        return `"${String(str).replace(/"/g, '""')}"`;
    }

    function debounce(fn, ms) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    }

    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function showToast(message, type = 'success') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${type === 'success' ? '#22c55e' : '#ef4444'}" stroke-width="2">
                ${type === 'success'
                ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
                : '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'}
            </svg>
            <span>${message}</span>
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toast-out 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // ===================== Table Header Sorting =====================
    function initTableSort() {
        $$('.data-table__th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (state.sortField === field) {
                    state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
                } else {
                    state.sortField = field;
                    state.sortDir = field === 'fraud_score' || field === 'amount' ? 'desc' : 'asc';
                }
                applyFilters();
            });
        });
    }

    // ===================== Init =====================
    function init() {
        initNavigation();
        initUpload();
        initFilters();
        initPagination();
        initModal();
        initReports();
        initTableSort();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
