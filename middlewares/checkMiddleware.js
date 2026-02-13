const API_KEY = process.env.API_KEY;
const WHITELISTED_IPS = process.env.WHITELISTED_IPS.split(',');
const API_KEY_EXPIRY = new Date(process.env.API_KEY_EXPIRY);

module.exports = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const clientIp = req.ip || req.connection.remoteAddress;
  
  // Validate API key
  if (!apiKey) {
    return res.status(401).json({ error: 'API key missing' });
  }
  
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  // Validate IP
  if (!WHITELISTED_IPS.includes(clientIp)) {
    return res.status(403).json({ error: 'IP not whitelisted' });
  }
  
  // Validate expiration
  if (new Date() > API_KEY_EXPIRY) {
    return res.status(403).json({ error: 'API key expired' });
  }
  
  next();
};
