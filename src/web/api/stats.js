const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const STATS_CACHE_FILE = path.join(CLAUDE_DIR, 'stats-cache.json');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

// Estimate cost based on model (rough estimation)
function estimateCost(tokens, model) {
  // Default to Sonnet pricing if unknown
  const inputPrice = 3e-6; // $3 per million
  const outputPrice = 15e-6; // $15 per million

  // Assume 50/50 split for estimation
  return (tokens / 2) * inputPrice + (tokens / 2) * outputPrice;
}

async function parseStatsCache() {
  try {
    const content = await fs.readFile(STATS_CACHE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function getProjectSessions() {
  const sessions = [];

  try {
    const projects = await fs.readdir(PROJECTS_DIR);

    for (const projectDir of projects) {
      const projectPath = path.join(PROJECTS_DIR, projectDir);
      const stat = await fs.stat(projectPath);

      if (!stat.isDirectory()) continue;

      // Decode project name
      const projectName = projectDir.replace(/-/g, '/').replace(/ /g, '/');

      const sessionFiles = await fs.readdir(projectPath);

      for (const sessionFile of sessionFiles) {
        if (!sessionFile.endsWith('.jsonl')) continue;
        if (sessionFile.startsWith('agent-')) continue; // Skip sub-agent sessions

        const sessionPath = path.join(projectPath, sessionFile);
        const sessionStat = await fs.stat(sessionPath);

        let sessionTokens = 0;
        let sessionModel = undefined;

        try {
          const content = await fs.readFile(sessionPath, 'utf-8');
          const lines = content.split('\n').filter(Boolean);

          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              if (entry.message?.usage) {
                sessionTokens +=
                  (entry.message.usage.input_tokens || 0) +
                  (entry.message.usage.output_tokens || 0);
              }
              if (entry.message?.model && !sessionModel) {
                sessionModel = entry.message.model;
              }
            } catch {
              // Skip invalid lines
            }
          }
        } catch {
          // Skip files that can't be read
        }

        sessions.push({
          sessionId: sessionFile.replace('.jsonl', ''),
          project: projectName,
          timestamp: sessionStat.mtimeMs,
          tokens: sessionTokens,
          model: sessionModel,
        });
      }
    }
  } catch {
    // Return empty if projects dir doesn't exist
  }

  // Sort by timestamp descending
  return sessions.sort((a, b) => b.timestamp - a.timestamp);
}

async function getStats(req, res) {
  try {
    const [cache, sessions] = await Promise.all([
      parseStatsCache(),
      getProjectSessions(),
    ]);

    const totalTokens = sessions.reduce((sum, s) => sum + s.tokens, 0);
    const totalCost = estimateCost(totalTokens);
    const sessionCount = sessions.length;

    // Extract metrics from cache if available
    const activeTime = cache.active_time_total || 0;
    const linesOfCode = cache.lines_of_code_count || 0;
    const commitCount = cache.commit_count || 0;
    const prCount = cache.pull_request_count || 0;

    const response = {
      totalTokens,
      totalCost,
      sessionCount,
      activeTime,
      linesOfCode,
      commitCount,
      prCount,
      recentSessions: sessions.slice(0, 20), // Last 20 sessions
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
}

module.exports = { getStats };
