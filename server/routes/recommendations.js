const express = require('express');
const { readJSON } = require('../utils/storage');

const router = express.Router();

const LEVEL_SCORE = { '初级': 1, '中级': 2, '高级': 3 };

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

router.get('/buddies/:userId', (req, res) => {
  const users = readJSON('users.json', []);
  const { userId } = req.params;
  const { instrument, maxDistance = 20, limit = 10 } = req.query;
  
  const currentUser = users.find(u => u.id === userId);
  if (!currentUser) {
    return res.status(404).json({ error: '用户不存在' });
  }
  
  const candidates = users.filter(u => u.id !== userId);
  
  const scored = candidates.map(candidate => {
    let score = 0;
    const details = { instrumentMatch: 0, levelMatch: 0, timeMatch: 0, distance: 0 };
    const reasons = [];
    
    const distance = haversineDistance(
      currentUser.latitude, currentUser.longitude,
      candidate.latitude, candidate.longitude
    );
    details.distance = distance;
    
    if (distance <= maxDistance) {
      const distScore = Math.max(0, 30 * (1 - distance / maxDistance));
      score += distScore;
    } else {
      return { ...candidate, score: -1, distance, matchDetails: details, isMatched: false, reasons: [] };
    }
    
    let sharedInstruments = [];
    if (instrument) {
      if (candidate.instruments.includes(instrument) && currentUser.instruments.includes(instrument)) {
        score += 35;
        details.instrumentMatch = 35;
        sharedInstruments.push(instrument);
      }
    } else {
      sharedInstruments = candidate.instruments.filter(i => currentUser.instruments.includes(i));
      if (sharedInstruments.length > 0) {
        const instScore = Math.min(35, 20 + sharedInstruments.length * 5);
        score += instScore;
        details.instrumentMatch = instScore;
      }
    }
    if (sharedInstruments.length > 0) {
      reasons.push({ factor: '共同乐器', text: `你们都弹${sharedInstruments.join('、')}` });
    }
    
    if (sharedInstruments.length > 0 || !instrument) {
      const levelDiff = Math.abs(
        (LEVEL_SCORE[candidate.skillLevel] || 2) - 
        (LEVEL_SCORE[currentUser.skillLevel] || 2)
      );
      const levelScore = levelDiff === 0 ? 20 : levelDiff === 1 ? 10 : 3;
      score += levelScore;
      details.levelMatch = levelScore;
      if (levelDiff === 0) {
        reasons.push({ factor: '水平接近', text: `你们都是${candidate.skillLevel}，水平完全匹配` });
      } else if (levelDiff === 1) {
        reasons.push({ factor: '水平接近', text: `你是${currentUser.skillLevel}，TA是${candidate.skillLevel}，水平较接近` });
      } else {
        reasons.push({ factor: '水平接近', text: `你是${currentUser.skillLevel}，TA是${candidate.skillLevel}` });
      }
    }
    
    const sharedTimes = candidate.freeTimes.filter(t => currentUser.freeTimes.includes(t));
    if (sharedTimes.length > 0) {
      const timeScore = Math.min(15, sharedTimes.length * 4);
      score += timeScore;
      details.timeMatch = timeScore;
      reasons.push({ factor: '空闲时间重合', text: `空闲时间重合：${sharedTimes.join('、')}` });
    }
    
    score += (candidate.rating || 5) * 2;
    
    const commonPieces = candidate.favoritePieces.filter(p => 
      currentUser.favoritePieces.includes(p)
    );
    if (commonPieces.length > 0) {
      reasons.push({ factor: '想练曲目', text: `都想练：${commonPieces.join('、')}` });
    }
    
    return {
      ...candidate,
      score: Math.round(score * 10) / 10,
      distance: Math.round(distance * 10) / 10,
      matchDetails: details,
      sharedInstruments,
      sharedTimes,
      commonPieces,
      isMatched: score >= 30,
      reasons
    };
  });
  
  const valid = scored.filter(s => s.score >= 0);
  valid.sort((a, b) => b.score - a.score);
  
  res.json({
    currentUser,
    totalMatches: valid.filter(v => v.isMatched).length,
    recommendations: valid.slice(0, limit)
  });
});

router.get('/instruments/:userId', (req, res) => {
  const instruments = readJSON('instruments.json', []);
  const users = readJSON('users.json', []);
  const { userId } = req.params;
  const { category, maxDistance = 30, limit = 12 } = req.query;
  
  const currentUser = users.find(u => u.id === userId);
  if (!currentUser) {
    return res.status(404).json({ error: '用户不存在' });
  }
  
  const available = instruments.filter(i => 
    i.ownerId !== userId && i.status === 'available'
  );
  
  const scored = available.map(inst => {
    let score = 0;
    const details = { categoryMatch: 0, distance: 0, priceScore: 0, ownerCreditScore: 0 };
    const reasons = [];
    
    const distance = haversineDistance(
      currentUser.latitude, currentUser.longitude,
      inst.latitude, inst.longitude
    );
    details.distance = distance;
    
    if (distance <= maxDistance) {
      const distScore = Math.max(0, 40 * (1 - distance / maxDistance));
      score += distScore;
      if (distance <= 3) {
        reasons.push({ factor: '距离', text: `距你仅${Math.round(distance * 10) / 10}km，非常近` });
      } else if (distance <= 10) {
        reasons.push({ factor: '距离', text: `距你${Math.round(distance * 10) / 10}km，较近` });
      } else {
        reasons.push({ factor: '距离', text: `距你${Math.round(distance * 10) / 10}km` });
      }
    } else {
      return { ...inst, score: -1, distance, matchDetails: details, owner: null, reasons: [] };
    }
    
    if (category && inst.category === category) {
      score += 30;
      details.categoryMatch = 30;
      reasons.push({ factor: '品类', text: `品类匹配你筛选的${category}` });
    } else if (!category && currentUser.instruments.includes(inst.category)) {
      score += 20;
      details.categoryMatch = 20;
      reasons.push({ factor: '品类', text: `${inst.category}正是你擅长的乐器` });
    }
    
    const owner = users.find(u => u.id === inst.ownerId) || null;
    if (owner) {
      const ownerCreditScore = (owner.rating || 5) * 3;
      score += ownerCreditScore;
      details.ownerCreditScore = ownerCreditScore;
      const rating = owner.rating || 5;
      if (rating >= 4.5) {
        reasons.push({ factor: '主人信用', text: `主人信用${rating}分，非常靠谱` });
      } else if (rating >= 3.5) {
        reasons.push({ factor: '主人信用', text: `主人信用${rating}分，信誉良好` });
      } else {
        reasons.push({ factor: '主人信用', text: `主人信用${rating}分` });
      }
    }

    const fee = inst.dailyFee || 0;
    let priceScore = 0;
    if (fee === 0) {
      priceScore = 15;
      reasons.push({ factor: '价格', text: '免费借用' });
    } else if (fee <= 30) {
      priceScore = 12;
      reasons.push({ factor: '价格', text: `日租¥${fee}，价格实惠` });
    } else if (fee <= 80) {
      priceScore = 8;
      reasons.push({ factor: '价格', text: `日租¥${fee}，价格适中` });
    } else {
      priceScore = 3;
      reasons.push({ factor: '价格', text: `日租¥${fee}` });
    }
    score += priceScore;
    details.priceScore = priceScore;
    
    return {
      ...inst,
      score: Math.round(score * 10) / 10,
      distance: Math.round(distance * 10) / 10,
      matchDetails: details,
      owner,
      reasons
    };
  });
  
  const valid = scored.filter(s => s.score >= 0);
  valid.sort((a, b) => b.score - a.score);
  
  res.json({
    total: valid.length,
    recommendations: valid.slice(0, limit)
  });
});

router.get('/pieces/:userId', (req, res) => {
  const users = readJSON('users.json', []);
  const checkins = readJSON('checkins.json', []);
  const { userId } = req.params;
  
  const currentUser = users.find(u => u.id === userId);
  if (!currentUser) {
    return res.status(404).json({ error: '用户不存在' });
  }
  
  const allPieces = new Map();
  
  users.forEach(u => {
    if (u.id !== userId) {
      u.favoritePieces.forEach(p => {
        if (!allPieces.has(p)) {
          allPieces.set(p, { piece: p, likes: 0, players: [], instrument: u.instruments[0] || '' });
        }
        const data = allPieces.get(p);
        data.likes++;
        if (!data.players.includes(u.id)) {
          data.players.push(u.id);
        }
      });
    }
  });
  
  checkins.forEach(c => {
    if (c.userId !== userId && c.piece) {
      if (!allPieces.has(c.piece)) {
        allPieces.set(c.piece, { piece: c.piece, likes: 0, checkins: 0, players: [], instrument: c.instrument });
      }
      const data = allPieces.get(c.piece);
      data.checkins = (data.checkins || 0) + 1;
      if (!data.players.includes(c.userId)) {
        data.players.push(c.userId);
      }
    }
  });
  
  const result = Array.from(allPieces.values()).map(p => {
    const isMyFavorite = currentUser.favoritePieces.includes(p.piece);
    const matchingPlayers = p.players.filter(pid => {
      const player = users.find(u => u.id === pid);
      if (!player) return false;
      const sharedInst = player.instruments.some(i => currentUser.instruments.includes(i));
      return sharedInst;
    });
    return {
      ...p,
      isMyFavorite,
      matchingCount: matchingPlayers.length,
      score: p.likes * 2 + (p.checkins || 0) + matchingPlayers.length * 3 + (isMyFavorite ? 10 : 0)
    };
  });
  
  result.sort((a, b) => b.score - a.score);
  
  res.json({
    userFavorites: currentUser.favoritePieces,
    recommendations: result.slice(0, 20)
  });
});

module.exports = router;
