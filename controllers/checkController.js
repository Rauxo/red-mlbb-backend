// BGMI Controller
exports.bgmiCheck = (req, res) => {
  const { gameCode, id } = req.query;
  
  if (!gameCode || !id) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  
  if (gameCode !== 'BGMI_IN') {
    return res.status(400).json({ error: 'Invalid game code' });
  }
  
  res.json({ 
    message: 'SUCCESS', 
    username: `Player${id.slice(-4)}` 
  });
};

// MLBB Controller
exports.mlbbCheck = (req, res) => {
  const { user_id, server_id } = req.query;
  
  if (!user_id || !server_id) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  
  res.json({
    user_id,
    server_id,
    username: `MLBBPlayer${user_id.slice(-4)}`,
    country: 'IN'
  });
};

// Genshin Impact Controller
exports.genshinCheck = (req, res) => {
  const { user_id, server_code } = req.query;
  const validServers = ['os_asia', 'os_america', 'os_europe', 'os_tw,hk,mo'];
  
  if (!user_id || !server_code) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  
  if (!validServers.includes(server_code)) {
    return res.status(400).json({ error: 'Invalid server code' });
  }
  
  res.json({
    user_id,
    username: `Traveler${user_id.slice(-4)}`
  });
};

// Health Check
exports.healthCheck = (req, res) => {
  res.json({ message: 'Hello User!' });
};
