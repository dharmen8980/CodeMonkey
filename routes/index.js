const chatRoutes = require('./chat-routes');
const taskRoutes = require('./task-routes');
const { handleArtifactGet } = require('./artifact-routes');
const dashboardRoutes = require('./dashboard-routes');
const turnsRoutes = require('./turns-routes');
const pipelineRoutes = require('./pipeline-routes');
const triageRoutes = require('./triage-routes');
const mrRoutes = require('./mr-routes');

// The ordered route table server.js delegates to once a request has passed the
// method guard, the unauthenticated-login special case, the auth gate, the CSRF
// gate, and JSON body parsing. Order matches the original inline if/else chain
// exactly — nothing here changes matching precedence.
function dispatch(req, res, payload) {
  const { method, url } = req;

  if (method === 'POST' && url === '/chat/message') return chatRoutes.handleChatMessage(req, res, payload);
  if (method === 'POST' && url === '/chat/approve') return chatRoutes.handleChatApprove(req, res, payload);
  if (method === 'POST' && url === '/chat/reject') return chatRoutes.handleChatReject(req, res, payload);
  if (method === 'POST' && url === '/chat/kill') return chatRoutes.handleChatKill(req, res, payload);
  if (method === 'GET' && url.startsWith('/chat/list')) return chatRoutes.handleChatListGet(req, res);
  if (method === 'GET' && url.startsWith('/chat/container')) return chatRoutes.handleChatContainerGet(req, res);
  if (method === 'GET' && url.startsWith('/chat/history')) return chatRoutes.handleChatHistory(req, res);
  if (method === 'GET' && url.startsWith('/chat/stats')) return chatRoutes.handleChatStats(req, res);
  if (method === 'GET' && url.startsWith('/chat/turn')) return chatRoutes.handleChatTurnGet(req, res);
  if (method === 'GET' && url.startsWith('/chat/stream')) return chatRoutes.handleChatStreamGet(req, res);

  if (method === 'POST' && url === '/task') return taskRoutes.handleTaskPost(req, res, payload);
  if (method === 'POST' && url === '/gitlab-webhook') return taskRoutes.handleGitlabWebhookPost(req, res, payload);
  if (method === 'POST' && url.startsWith('/spawn/')) return taskRoutes.handleSpawn(req, res);
  if (method === 'GET' && url === '/tasks') return taskRoutes.handleTasksGet(req, res);

  if (method === 'GET' && url.startsWith('/artifacts/')) return handleArtifactGet(req, res);

  if (method === 'GET' && url.startsWith('/api/turns/tool')) return turnsRoutes.handleToolDetailApiGet(req, res);
  if (method === 'GET' && url.startsWith('/api/turns/prompt')) return turnsRoutes.handlePromptApiGet(req, res);
  if (method === 'GET' && url.startsWith('/api/turns/live')) return turnsRoutes.handleTurnsLiveApiGet(req, res);
  if (method === 'GET' && url.startsWith('/api/turns')) return turnsRoutes.handleTurnsApiGet(req, res);
  if (method === 'GET' && url === '/turns') return turnsRoutes.handleTurnsPage(req, res);
  if (method === 'GET' && (url === '/turns.js' || url === '/turns.css')) return turnsRoutes.handleTurnsAsset(req, res);

  if (method === 'POST' && url === '/api/pipeline/tickets') return pipelineRoutes.handlePipelineTicketsPost(req, res, payload);
  const clarifyMatch = method === 'POST' && url.match(/^\/api\/pipeline\/([a-f0-9]{16})\/clarify$/);
  if (clarifyMatch) return pipelineRoutes.handlePipelineClarifyPost(req, res, payload, clarifyMatch[1]);
  const retryMatch = method === 'POST' && url.match(/^\/api\/pipeline\/([a-f0-9]{16})\/retry$/);
  if (retryMatch) return pipelineRoutes.handlePipelineRetryPost(req, res, payload, retryMatch[1]);
  const forcePassMatch = method === 'POST' && url.match(/^\/api\/pipeline\/([a-f0-9]{16})\/(?:verify-pass|force-pass)$/);
  if (forcePassMatch) return pipelineRoutes.handlePipelineForcePassPost(req, res, payload, forcePassMatch[1]);
  const forceFailMatch = method === 'POST' && url.match(/^\/api\/pipeline\/([a-f0-9]{16})\/(?:verify-fail|force-fail)$/);
  if (forceFailMatch) return pipelineRoutes.handlePipelineForceFailPost(req, res, payload, forceFailMatch[1]);
  if (method === 'GET' && url.startsWith('/api/pipeline')) return pipelineRoutes.handlePipelineApiGet(req, res);
  if (method === 'GET' && url === '/pipeline') return pipelineRoutes.handlePipelinePage(req, res);
  if (method === 'GET' && (url === '/pipeline.js' || url === '/pipeline.css')) return pipelineRoutes.handlePipelineAsset(req, res);

  if (method === 'GET' && url.startsWith('/api/triage/live')) return triageRoutes.handleTriageLiveApiGet(req, res);
  if (method === 'GET' && url.startsWith('/api/triage')) return triageRoutes.handleTriageApiGet(req, res);
  if (method === 'GET' && url === '/triage') return triageRoutes.handleTriagePage(req, res);
  if (method === 'GET' && (url === '/triage.js' || url === '/triage.css')) return triageRoutes.handleTriageAsset(req, res);

  if (method === 'GET' && url === '/mr') return mrRoutes.handleMrPage(req, res);
  if (method === 'GET' && url === '/mr.js') return mrRoutes.handleMrAsset(req, res);

  if (method === 'GET' && (url === '/chat' || url === '/chat.js')) return dashboardRoutes.handleChatPage(req, res);
  if (method === 'GET' && (url === '/' || url === '/dashboard')) return turnsRoutes.handleTurnsPage(req, res);
  if (method === 'GET' && ['/dashboard.css', '/dashboard-mobile.css', '/dashboard.js'].includes(url)) {
    return dashboardRoutes.handleDashboardAsset(req, res);
  }

  return dashboardRoutes.handleDefault(req, res);
}

module.exports = { dispatch };
