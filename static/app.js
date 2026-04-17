// --- App State ---
let transactionsData = [];
let analyzedData = [];
let riskChartInstance = null;

// --- DOM Elements ---
const navItems = document.querySelectorAll('.nav-item');
const pageSections = document.querySelectorAll('.page-section');
const headerTitle = document.getElementById('page-title');
const fileInput = document.getElementById('csv-file');
const dropZone = document.getElementById('drop-zone');
const uploadStatus = document.getElementById('upload-status');
const analyzeBtn = document.getElementById('analyze-btn');
const exportPdfBtn = document.getElementById('export-pdf-btn');
const toastContainer = document.getElementById('toast-container');

// --- Utilities ---
// Formatting Currency in Indian format with ₹ symbol
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2
    }).format(amount);
};

const showToast = (message, type = 'info') => {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// --- Navigation Logic ---
navItems.forEach(item => {
    item.addEventListener('click', () => {
        const targetId = item.getAttribute('data-target');
        
        // Active states
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        
        // Change Header Title
        headerTitle.textContent = item.textContent.replace(/[^\w\s]/g, '').trim();
        
        // Toggle Sections
        pageSections.forEach(section => {
            if(section.id === targetId) {
                section.classList.add('active');
            } else {
                section.classList.remove('active');
            }
        });
        
        // Manage PDF Export Button visibility
        if(targetId === 'dashboard' && analyzedData.length > 0) {
            exportPdfBtn.style.display = 'block';
        } else {
            exportPdfBtn.style.display = 'none';
        }
    });
});

// --- File Upload Logic ---
fileInput.addEventListener('change', handleFileSelect);

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        handleFileSelect();
    }
});

function handleFileSelect() {
    const file = fileInput.files[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
        uploadStatus.textContent = 'Please upload a valid CSV file.';
        uploadStatus.className = 'status-msg text-error';
        analyzeBtn.disabled = true;
        return;
    }

    uploadStatus.textContent = `File selected: ${file.name}. Ready to analyze.`;
    uploadStatus.className = 'status-msg text-success';
    analyzeBtn.disabled = false;
}

// --- Fraud Detection Logic ---
analyzeBtn.addEventListener('click', () => {
    const file = fileInput.files[0];
    if (!file) return;

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Processing Data...';
    
    // Parse CSV with PapaParse
    Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function(results) {
            if(results.errors.length > 0 && results.data.length === 0) {
                uploadStatus.textContent = 'Error parsing CSV file. Please check format.';
                uploadStatus.className = 'status-msg text-error';
                showToast('Invalid CSV format', 'error');
                analyzeBtn.disabled = false;
                analyzeBtn.textContent = 'Analyze Data';
                return;
            }
            
            transactionsData = results.data;
            detectFraud();
        },
        error: function(error) {
            uploadStatus.textContent = 'Failed to read file.';
            uploadStatus.className = 'status-msg text-error';
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'Analyze Data';
        }
    });
});

function detectFraud() {
    analyzedData = transactionsData.map(tx => {
        // Safe parsing of fields
        const amount = parseFloat(tx.amount) || 0;
        const avg_amount = parseFloat(tx.avg_amount) || amount;
        const time = tx.time_of_day ? String(tx.time_of_day).toLowerCase() : 'day';
        const loc = tx.location || '';
        const home_loc = tx.home_location || '';
        const ip = tx.ip_address || '';
        
        let risk_score = 0;
        let risk_factors = [];
        let risk_level = 'LOW';
        
        let isHighRisk = false;
        
        // --- High Risk Rules ---
        if (amount > avg_amount * 5 && (time.includes('night') || time === 'late night')) {
            isHighRisk = true;
            risk_factors.push('Amount > 5x average during Night time');
            risk_score += 0.8;
        }
        
        if (loc && home_loc && loc.trim().toLowerCase() !== home_loc.trim().toLowerCase()) {
            isHighRisk = true;
            risk_factors.push('Location mismatch (outside home area)');
            risk_score += 0.6;
        }
        
        if (ip && ip.length > 0) {
            // Suspicious IP approximation (flag non-standard or explicitly weird IPs)
            if (!ip.startsWith('192.168.') && !ip.startsWith('10.') && !ip.startsWith('127.')) {
                // For demonstration, let's just add a small heuristic
                if (tx.is_suspicious_ip === true || ip.includes('proxy') || String(tx.region).toLowerCase().includes('unknown')) {
                     isHighRisk = true;
                     risk_factors.push('Suspicious IP Address / Region');
                     risk_score += 0.5;
                }
            }
        }
        
        // --- Medium Risk Rules ---
        let isMediumRisk = false;
        if (!isHighRisk) {
            if (amount > avg_amount * 2) {
                isMediumRisk = true;
                risk_factors.push('Unusually high amount (> 2x average)');
                risk_score += 0.4;
            }
            if (time.includes('night') || time === 'late night') {
                isMediumRisk = true;
                risk_factors.push('Unusual time of day');
                risk_score += 0.3;
            }
        }
        
        // Resolve risk tier
        if (isHighRisk) {
            risk_level = 'HIGH';
            risk_score = Math.min(1.0, risk_score + 0.1);
        } else if (isMediumRisk) {
            risk_level = 'MEDIUM';
        } else {
            risk_level = 'LOW';
            risk_score = Math.random() * 0.2; // 0 to 0.2
            risk_factors.push('Normal transaction behavior');
        }
        
        return {
            ...tx,
            fraud_score: risk_score.toFixed(2),
            risk_level: risk_level,
            risk_factors: risk_factors.join('; ')
        };
    });
    
    updateDashboardUI();
    updateHistoryTable();
    
    showToast('Analysis completed successfully!', 'success');
    
    // Reset button
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze Data';
    
    // Auto-navigate to dashboard
    navItems[0].click();
}

// --- Dashboard UI Updates ---
function updateDashboardUI() {
    const total = analyzedData.length;
    const highRiskTx = analyzedData.filter(t => t.risk_level === 'HIGH');
    const fraudCount = highRiskTx.length;
    
    const riskExposure = highRiskTx.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
    const highRiskPct = total > 0 ? ((fraudCount / total) * 100).toFixed(1) : 0;
    
    // Update metric cards
    document.getElementById('total-tx').textContent = total.toLocaleString();
    document.getElementById('fraud-count').textContent = fraudCount.toLocaleString();
    document.getElementById('risk-exposure').textContent = formatCurrency(riskExposure);
    document.getElementById('high-risk-pct').textContent = `${highRiskPct}%`;
    
    // Feature 1: Update Risk Distribution Chart
    const mediumRiskTx = analyzedData.filter(t => t.risk_level === 'MEDIUM');
    const lowRiskTx = analyzedData.filter(t => t.risk_level === 'LOW');
    
    const chartCtx = document.getElementById('riskChart');
    if (chartCtx) {
        if (riskChartInstance) {
            riskChartInstance.destroy();
        }
        
        riskChartInstance = new Chart(chartCtx, {
            type: 'doughnut',
            data: {
                labels: ['LOW Risk', 'MEDIUM Risk', 'HIGH Risk'],
                datasets: [{
                    data: [lowRiskTx.length, mediumRiskTx.length, highRiskTx.length],
                    backgroundColor: ['#059669', '#D97706', '#DC2626'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#F8FAFC' }
                    }
                }
            }
        });
    }
    
    // Update Recent Fraud Table (Top 5)
    const tbody = document.querySelector('#recent-fraud-table tbody');
    tbody.innerHTML = '';
    
    const recentFrauds = highRiskTx.slice(0, 5);
    
    if (recentFrauds.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No high-risk transactions detected.</td></tr>';
    } else {
        recentFrauds.forEach(tx => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${tx.id || 'N/A'}</td>
                <td style="font-weight: 500;">${formatCurrency(tx.amount || 0)}</td>
                <td>${tx.location || '-'}</td>
                <td><span class="badge badge-high">HIGH RISK</span></td>
            `;
            tbody.appendChild(tr);
        });
    }
}

// --- Transaction History Table ---
function updateHistoryTable() {
    const tbody = document.querySelector('#transactions-table tbody');
    tbody.innerHTML = '';
    
    if (analyzedData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="text-center">No data available. Upload a CSV first.</td></tr>';
        return;
    }
    
    analyzedData.forEach((tx, index) => {
        const badgeClass = `badge-${tx.risk_level.toLowerCase()}`;
        const tr = document.createElement('tr');
        
        tr.innerHTML = `
            <td style="font-family: monospace; font-size: 0.85rem;">${tx.id || '-'}</td>
            <td style="font-weight: 600;">${formatCurrency(tx.amount || 0)}</td>
            <td>${tx.location || '-'}</td>
            <td>${tx.time_of_day || '-'}</td>
            <td><strong>${tx.fraud_score}</strong></td>
            <td><span class="badge ${badgeClass}">${tx.risk_level}</span></td>
            <td style="max-width: 200px; white-space: normal; font-size: 0.8rem; line-height: 1.4;">${tx.risk_factors}</td>
            <td style="font-family: monospace; font-size: 0.8rem;">${tx.ip_address || '-'}</td>
            <td>${tx.region || '-'}</td>
            <td>${tx.merchant || '-'}</td>
            <td>
                <button class="btn btn-action" onclick="viewInsights(${index})">View Insights</button>
            </td>
            <td style="max-width: 250px; white-space: normal; font-size: 0.85rem; line-height: 1.4;" id="explain-cell-${index}">
                <button class="btn btn-outline" style="padding: 4px 8px; font-size: 0.75rem;" onclick="explainTransactionRow(${index})">Explain</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- LLaMA (Ollama) Integration ---
window.explainTransactionRow = async function(index) {
    const tx = analyzedData[index];
    if (!tx) return;
    
    const cell = document.getElementById(`explain-cell-${index}`);
    if (!cell) return;
    
    cell.innerHTML = '<span style="color: #94A3B8; font-style: italic;">Generating explanation...</span>';
    
    const prompt = `You are a financial fraud detection assistant.
Explain this transaction in simple terms:

Transaction:
- Amount: ${formatCurrency(tx.amount || 0)}
- Location: ${tx.location || 'Unknown'}
- Time: ${tx.time_of_day || 'Unknown'}
- Risk Level: ${tx.risk_level}
- Risk Factors: ${tx.risk_factors || 'None'}

Return ONLY a short explanation (2-3 lines). Use simple human language. No technical terms.`;

    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3.1',
                prompt: prompt,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        cell.innerHTML = `<span style="color: #F8FAFC;">${data.response.trim()}</span>`;
    } catch (error) {
        console.error("LLaMA Connection Error for Explanation:", error);
        cell.innerHTML = '<span style="color: #DC2626;">AI explanation unavailable</span>';
    }
};

window.viewInsights = async function(index) {
    const tx = analyzedData[index];
    if (!tx) return;
    
    // Switch to Intelligence Tab
    navItems[3].click();
    
    const insightContent = document.getElementById('ai-insight-content');
    const loading = document.getElementById('ai-loading');
    
    insightContent.style.display = 'none';
    loading.style.display = 'flex';
    
    const prompt = `You are a financial fraud analyst.
Return ONLY:
Cause: ...
Effect: ...
Awareness: ...

Transaction details:
ID: ${tx.id}
Amount: ${tx.amount}
Avg Amount: ${tx.avg_amount}
Location: ${tx.location}
Home Location: ${tx.home_location}
Time: ${tx.time_of_day}
IP: ${tx.ip_address}
Risk Level: ${tx.risk_level}
Risk Factors: ${tx.risk_factors}`;

    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama3.1',
                prompt: prompt,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        const llmResponse = data.response;
        
        // Parse LLaMA Response
        let cause = "Could not parse clearly from AI response.";
        let effect = "Could not parse clearly from AI response.";
        let awareness = "Could not parse clearly from AI response.";
        
        const causeMatch = llmResponse.match(/Cause:\s*(.*?)(?=\nEffect:|$)/is);
        const effectMatch = llmResponse.match(/Effect:\s*(.*?)(?=\nAwareness:|$)/is);
        const awarenessMatch = llmResponse.match(/Awareness:\s*(.*?)(?=$)/is);
        
        if (causeMatch) cause = causeMatch[1].trim();
        if (effectMatch) effect = effectMatch[1].trim();
        if (awarenessMatch) awareness = awarenessMatch[1].trim();

        if (!causeMatch && !effectMatch && !awarenessMatch) {
            // Fallback if LLM doesn't follow instructions perfectly
            insightContent.innerHTML = `
                <h3 style="margin-bottom: 20px;">AI Analysis for ID: <span style="font-family: monospace; color: var(--text-secondary);">${tx.id}</span></h3>
                <div class="insight-block">
                    <p style="white-space: pre-wrap; font-size: 1rem;">${llmResponse}</p>
                </div>
            `;
        } else {
            insightContent.innerHTML = `
                <h3 style="margin-bottom: 24px; font-weight: 600;">AI Analysis for ID: <span style="font-family: monospace; color: var(--text-secondary);">${tx.id}</span></h3>
                
                <div class="insight-block cause">
                    <h4>🔍 Cause</h4>
                    <p>${cause}</p>
                </div>
                
                <div class="insight-block effect">
                    <h4>⚠️ Effect</h4>
                    <p>${effect}</p>
                </div>
                
                <div class="insight-block awareness">
                    <h4>💡 Awareness</h4>
                    <p>${awareness}</p>
                </div>
            `;
        }
    } catch (error) {
        console.error("LLaMA Connection Error:", error);
        insightContent.innerHTML = `
            <div class="insight-block cause" style="text-align: center; border-left: none; padding: 40px;">
                <div style="font-size: 3rem; margin-bottom: 10px;">🔌</div>
                <h4 style="justify-content: center; color: var(--risk-high); font-size: 1.3rem;">Ollama Connection Failed</h4>
                <p style="margin-top: 10px;">Could not connect to local LLaMA instance at <code>http://localhost:11434</code>.</p>
                <p style="margin-top: 5px;">Ensure Ollama is running and CORS is configured correctly.</p>
                <p style="margin-top: 15px; font-size: 0.85rem; color: var(--text-secondary);">Error details: ${error.message}</p>
            </div>
        `;
        showToast('Failed to connect to AI engine', 'error');
    } finally {
        loading.style.display = 'none';
        insightContent.style.display = 'block';
    }
};

// --- PDF Report Generation (Using html2canvas for perfect ₹ rendering) ---
exportPdfBtn.addEventListener('click', async () => {
    if (analyzedData.length === 0) {
        showToast('No data available to export.', 'error');
        return;
    }
    
    exportPdfBtn.disabled = true;
    const originalText = exportPdfBtn.textContent;
    exportPdfBtn.textContent = 'Generating PDF...';
    
    try {
        const totalTx = analyzedData.length;
        const highRiskTx = analyzedData.filter(t => t.risk_level === 'HIGH');
        const riskExposure = highRiskTx.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
        
        // 1. Populate the hidden PDF HTML template
        const summaryHtml = `
            <p style="margin: 5px 0;"><strong>Generated on:</strong> ${new Date().toLocaleString()}</p>
            <p style="margin: 5px 0;"><strong>Total Transactions:</strong> ${totalTx.toLocaleString()}</p>
            <p style="margin: 5px 0;"><strong>High Risk Count:</strong> ${highRiskTx.length.toLocaleString()}</p>
            <p style="margin: 5px 0;"><strong>Total Risk Exposure:</strong> <span style="color: #DC2626; font-weight: bold;">${formatCurrency(riskExposure)}</span></p>
        `;
        document.getElementById('pdf-summary').innerHTML = summaryHtml;
        
        const tbody = document.querySelector('#pdf-table tbody');
        tbody.innerHTML = '';
        
        // Limit export size to avoid breaking html2canvas on huge datasets
        const txToExport = analyzedData.slice(0, 50); 
        
        txToExport.forEach(tx => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding: 8px; border: 1px solid #ddd;">${tx.id || '-'}</td>
                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">${formatCurrency(tx.amount || 0)}</td>
                <td style="padding: 8px; border: 1px solid #ddd; color: ${tx.risk_level === 'HIGH' ? '#DC2626' : (tx.risk_level === 'MEDIUM' ? '#D97706' : '#059669')}; font-weight: bold;">
                    ${tx.risk_level}
                </td>
                <td style="padding: 8px; border: 1px solid #ddd;">${tx.risk_factors || 'None'}</td>
            `;
            tbody.appendChild(tr);
        });
        
        // 2. Render HTML to Canvas to preserve ₹ symbol naturally
        const pdfContainer = document.getElementById('pdf-container');
        const canvas = await html2canvas(pdfContainer, { 
            scale: 2,
            useCORS: true,
            logging: false
        });
        
        const imgData = canvas.toDataURL('image/png');
        
        // 3. Create PDF and add the image
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'pt', 'a4');
        
        const pdfWidth = doc.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        
        doc.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        doc.save('FraudInsight_Report.pdf');
        
        showToast('PDF Exported Successfully', 'success');
    } catch (e) {
        console.error("PDF Generation Error:", e);
        showToast('Failed to generate PDF', 'error');
    } finally {
        exportPdfBtn.disabled = false;
        exportPdfBtn.textContent = originalText;
    }
});
