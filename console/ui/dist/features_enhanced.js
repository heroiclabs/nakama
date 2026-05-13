// Enhanced Features Tab Rendering
// Complete world-class implementation with expandable cards

async function loadFeatures() {
    try {
        const data = await callRpc('analytics_feature_adoption', getGamePayload());
        if (data.error) {
            document.querySelector('#featureTable tbody').innerHTML = `<tr><td colspan="6" class="empty-state">${data.error}</td></tr>`;
            return;
        }
        
        const features = data.features || [];
        
        // Calculate KPIs
        const healthyCount = features.filter(f => f.health === 'healthy').length;
        const moderateCount = features.filter(f => f.health === 'moderate').length;
        const atRiskCount = features.filter(f => f.health === 'at_risk').length;
        const unusedCount = features.filter(f => f.health === 'unused').length;
        const avgAdoption = features.length > 0 ? Math.round(features.reduce((sum, f) => sum + f.adoption_pct, 0) / features.length) : 0;
        const avgEngagement = features.filter(f => f.users_count > 0).length > 0 
            ? Math.round(features.filter(f => f.users_count > 0).reduce((sum, f) => sum + f.events_per_user, 0) / features.filter(f => f.users_count > 0).length * 10) / 10 
            : 0;
        
        // Render KPIs
        document.getElementById('featureKpis').innerHTML = [
            { label: '🟢 Healthy', value: healthyCount, color: 'var(--success)' },
            { label: '🟡 Moderate', value: moderateCount, color: 'var(--warning)' },
            { label: '🔴 At Risk', value: atRiskCount, color: 'var(--danger)' },
            { label: '⚪ Unused', value: unusedCount, color: 'var(--text-muted)' },
            { label: 'Avg Adoption', value: avgAdoption + '%', color: 'var(--primary)' },
            { label: 'Avg Engagement', value: avgEngagement + ' events/user', color: 'var(--primary)' }
        ].map(k => `<div class="kpi-item"><div class="kpi-value" style="color:${k.color}">${k.value}</div><div class="kpi-label">${k.label}</div></div>`).join('');
        
        const tbody = document.querySelector('#featureTable tbody');
        if (features.length) {
            tbody.innerHTML = features.map((f, idx) => {
                // Health-based styling
                const healthClass = f.adoption_pct >= 30 ? 'positive' : f.adoption_pct >= 10 ? '' : 'negative';
                const healthEmoji = f.health === 'healthy' ? '🟢' : f.health === 'moderate' ? '🟡' : f.health === 'at_risk' ? '🔴' : '⚪';
                const barWidth = Math.min(f.adoption_pct, 100);
                
                // Trend arrow
                const trend = f.trend || { direction: 'flat', change_pct: 0 };
                const trendArrow = trend.direction === 'up' ? '📈' : trend.direction === 'down' ? '📉' : '→';
                const trendColor = trend.direction === 'up' ? 'var(--success)' : trend.direction === 'down' ? 'var(--danger)' : 'var(--text-muted)';
                const trendText = trend.change_pct > 0 ? '+' + trend.change_pct : trend.change_pct;
                
                // Engagement depth indicator
                const engagementDepth = f.events_per_user >= 10 ? '🔥 High' : f.events_per_user >= 3 ? '✓ Medium' : f.events_per_user > 0 ? '○ Low' : '—';
                const engagementColor = f.events_per_user >= 10 ? 'var(--success)' : f.events_per_user >= 3 ? 'var(--warning)' : 'var(--text-muted)';
                
                // Cohorts
                const cohorts = f.cohorts || { d1: 0, d7: 0, d30: 0 };
                const cohortText = `D1: ${cohorts.d1}% → D7: ${cohorts.d7}% → D30: ${cohorts.d30}%`;
                
                return `<tr onclick="toggleFeatureDetails('feature_${idx}')" style="cursor:pointer;">
                    <td>${healthEmoji} ${f.name.replace(/_/g,' ')}</td>
                    <td>${formatNumber(f.users_count)}</td>
                    <td><span class="${healthClass}" style="font-weight:600;">${f.adoption_pct}%</span></td>
                    <td style="font-size:0.85rem;color:${trendColor};">${trendArrow} ${trendText}%</td>
                    <td>
                        <div style="display:flex;align-items:center;gap:0.5rem;">
                            <div style="flex:1;background:var(--border);border-radius:4px;height:8px;min-width:60px;"><div style="width:${barWidth}%;background:var(--${healthClass==='positive'?'success':healthClass==='negative'?'danger':'warning'});height:8px;border-radius:4px;"></div></div>
                            <span style="font-size:0.72rem;color:${engagementColor};white-space:nowrap;" title="${f.events_per_user} events per user">${engagementDepth}</span>
                        </div>
                    </td>
                    <td style="font-size:0.75rem;color:var(--text-muted);">${cohortText}</td>
                </tr>
                <tr id="feature_${idx}" class="feature-details-row" style="display:none;">
                    <td colspan="6" style="padding:0;">
                        ${renderFeatureDetails(f)}
                    </td>
                </tr>`;
            }).join('');
        } else {
            tbody.innerHTML = `<tr><td colspan="6" style="padding:1rem 0.75rem;color:var(--text-muted);font-size:0.85rem;">
                No feature usage events in the last ${selectedDays} days. Expected events include:
                <code style="display:block;margin-top:0.5rem;padding:0.5rem;background:var(--card-bg);border-radius:4px;font-size:0.78rem;">
                daily_quiz_*, multiplayer_*, leaderboard_*, profile_*, store_*, voice_answer_*, ai_*, streak_*, friend_*
                </code>
            </td></tr>`;
        }
        
        const recs = document.getElementById('featureRecommendations');
        if (recs && data.recommendations) {
            recs.innerHTML = data.recommendations.map(r => `<li>${r}</li>`).join('');
        }
    } catch (e) {
        console.error('Features error:', e);
        document.querySelector('#featureTable tbody').innerHTML = `<tr><td colspan="6" class="empty-state">Failed to load: ${e.message}</td></tr>`;
    }
}

function toggleFeatureDetails(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}

function renderFeatureDetails(feature) {
    const segments = feature.user_segments || { first_time: 0, retained: 0, power: 0 };
    const revenue = feature.revenue || { avg_per_user: 0, multiplier: 0 };
    const funnel = feature.funnel;
    const correlations = feature.correlations || [];
    
    let html = '<div style="background:var(--card-bg);padding:1.5rem;border-top:1px solid var(--border);">';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1rem;">';
    
    // User Segments Card
    html += `<div style="background:var(--bg);padding:1rem;border-radius:8px;border:1px solid var(--border);">
        <h4 style="margin:0 0 0.75rem;font-size:0.9rem;color:var(--text-muted);">👤 User Segments</h4>
        <div style="display:flex;flex-direction:column;gap:0.5rem;">
            <div style="display:flex;justify-content:space-between;">
                <span style="font-size:0.85rem;">First-time users</span>
                <span style="font-weight:600;">${segments.first_time}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
                <span style="font-size:0.85rem;">Retained users (2-9×)</span>
                <span style="font-weight:600;color:var(--warning);">${segments.retained}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
                <span style="font-size:0.85rem;">Power users (10+×)</span>
                <span style="font-weight:600;color:var(--success);">${segments.power}</span>
            </div>
        </div>
    </div>`;
    
    // Revenue Attribution Card
    if (revenue.avg_per_user > 0) {
        html += `<div style="background:var(--bg);padding:1rem;border-radius:8px;border:1px solid var(--border);">
            <h4 style="margin:0 0 0.75rem;font-size:0.9rem;color:var(--text-muted);">💰 Revenue Attribution</h4>
            <div style="display:flex;flex-direction:column;gap:0.5rem;">
                <div style="display:flex;justify-content:space-between;">
                    <span style="font-size:0.85rem;">Avg $ per user</span>
                    <span style="font-weight:600;color:var(--success);">$${revenue.avg_per_user.toFixed(2)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;">
                    <span style="font-size:0.85rem;">vs Baseline</span>
                    <span style="font-weight:600;color:${revenue.multiplier >= 1 ? 'var(--success)' : 'var(--danger)'};">${revenue.multiplier}x</span>
                </div>
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem;">
                    ${revenue.multiplier >= 1.5 ? '🎯 High-value segment!' : revenue.multiplier >= 1 ? '✓ Above baseline' : '⚠️ Below baseline'}
                </div>
            </div>
        </div>`;
    }
    
    // Funnel Card
    if (funnel && funnel.steps && funnel.steps.length > 0) {
        html += `<div style="background:var(--bg);padding:1rem;border-radius:8px;border:1px solid var(--border);">
            <h4 style="margin:0 0 0.75rem;font-size:0.9rem;color:var(--text-muted);">🎪 Conversion Funnel</h4>
            <div style="display:flex;flex-direction:column;gap:0.5rem;">`;
        funnel.steps.forEach((step, idx) => {
            const isLast = idx === funnel.steps.length - 1;
            html += `<div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:0.75rem;max-width:60%;">${step.step.replace(/_/g,' ')}</span>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <span style="font-size:0.85rem;font-weight:600;">${formatNumber(step.count)}</span>
                    ${idx > 0 ? `<span style="font-size:0.75rem;color:${step.conversion >= 70 ? 'var(--success)' : step.conversion >= 40 ? 'var(--warning)' : 'var(--danger)'};">${step.conversion}%</span>` : ''}
                </div>
            </div>`;
            if (!isLast) html += '<div style="margin-left:1rem;color:var(--text-muted);font-size:0.75rem;">↓</div>';
        });
        html += `<div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border);font-size:0.85rem;font-weight:600;color:${funnel.final_conversion >= 50 ? 'var(--success)' : funnel.final_conversion >= 20 ? 'var(--warning)' : 'var(--danger)'};">
                Final: ${funnel.final_conversion}% conversion
            </div>`;
        html += `</div></div>`;
    }
    
    // Correlations Card
    if (correlations.length > 0) {
        html += `<div style="background:var(--bg);padding:1rem;border-radius:8px;border:1px solid var(--border);">
            <h4 style="margin:0 0 0.75rem;font-size:0.9rem;color:var(--text-muted);">🔗 Also Use</h4>
            <div style="display:flex;flex-direction:column;gap:0.5rem;">`;
        correlations.forEach(corr => {
            html += `<div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:0.85rem;">${corr.feature}</span>
                <span style="font-weight:600;color:var(--primary);">${corr.pct}%</span>
            </div>`;
        });
        html += `</div></div>`;
    }
    
    html += '</div></div>';
    return html;
}
