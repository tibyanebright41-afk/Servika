const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'servicebenin_secret_key_2024';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Base de données
let users = [];
let services = [];
let transactions = [];
let conversations = [];
let messages = [];

// Middleware d'authentification
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requis' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token invalide' });
    req.user = user;
    next();
  });
};

// Routes Utilisateurs
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, phone, email, userType, password } = req.body;

    const existingUser = users.find(u => u.phone === phone);
    if (existingUser) {
      return res.status(400).json({ error: 'Ce numéro est déjà utilisé' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: Date.now().toString(),
      fullName,
      phone,
      email,
      userType,
      password: hashedPassword,
      balance: 0,
      rating: 5.0,
      completedServices: 0,
      isOnline: false,
      lastSeen: new Date(),
      createdAt: new Date()
    };

    users.push(newUser);

    const token = jwt.sign(
      { userId: newUser.id, phone: newUser.phone }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      user: {
        id: newUser.id,
        fullName: newUser.fullName,
        phone: newUser.phone,
        email: newUser.email,
        userType: newUser.userType,
        balance: newUser.balance,
        rating: newUser.rating,
        completedServices: newUser.completedServices
      },
      token
    });

  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = users.find(u => u.phone === phone);

    if (!user) {
      return res.status(400).json({ error: 'Utilisateur non trouvé' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Mot de passe incorrect' });
    }

    user.isOnline = true;
    user.lastSeen = new Date();

    const token = jwt.sign(
      { userId: user.id, phone: user.phone }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        userType: user.userType,
        balance: user.balance,
        rating: user.rating,
        completedServices: user.completedServices,
        isOnline: user.isOnline
      },
      token
    });

  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Routes Services
app.get('/api/services', (req, res) => {
  const { category, location, search, minPrice, maxPrice } = req.query;
  
  let filteredServices = services.filter(service => service.status === 'active');

  if (category && category !== 'all') {
    filteredServices = filteredServices.filter(service => service.category === category);
  }

  if (location) {
    filteredServices = filteredServices.filter(service => 
      service.location.toLowerCase().includes(location.toLowerCase())
    );
  }

  if (search) {
    filteredServices = filteredServices.filter(service =>
      service.title.toLowerCase().includes(search.toLowerCase()) ||
      service.description.toLowerCase().includes(search.toLowerCase())
    );
  }

  if (minPrice) {
    filteredServices = filteredServices.filter(service => service.price >= parseInt(minPrice));
  }

  if (maxPrice) {
    filteredServices = filteredServices.filter(service => service.price <= parseInt(maxPrice));
  }

  filteredServices.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(filteredServices);
});

app.get('/api/services/:id', (req, res) => {
  const service = services.find(s => s.id === req.params.id);
  if (!service) {
    return res.status(404).json({ error: 'Service non trouvé' });
  }
  res.json(service);
});

app.post('/api/services', authenticateToken, (req, res) => {
  const { title, description, category, price, location, images } = req.body;

  const user = users.find(u => u.id === req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'Utilisateur non trouvé' });
  }

  const newService = {
    id: Date.now().toString(),
    title,
    description,
    category,
    price: parseInt(price),
    location,
    images: images || [],
    providerId: req.user.userId,
    providerName: user.fullName,
    providerPhone: user.phone,
    providerRating: user.rating,
    status: 'active',
    isFeatured: false,
    isUrgent: false,
    completed: false,
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  services.push(newService);
  res.json({ success: true, service: newService });
});

// 🎯 NOUVELLE FONCTION DE PAIEMENT SIMPLIFIÉE
app.post('/api/transactions/payment', authenticateToken, (req, res) => {
  const { serviceId, amount, operator, userNumber, confirmCode } = req.body;

  // VÉRIFICATION DU CODE
  const validCodes = ["2024", "1234"];
  if (!validCodes.includes(confirmCode)) {
    return res.json({ 
      success: false, 
      error: 'Code de vérification incorrect. Utilisez: 2024 ou 1234' 
    });
  }

  const service = services.find(s => s.id === serviceId);
  if (!service) {
    return res.status(404).json({ error: 'Service non trouvé' });
  }

  const client = users.find(u => u.id === req.user.userId);
  if (!client) {
    return res.status(404).json({ error: 'Client non trouvé' });
  }

  const commission = amount * 0.10;
  const providerAmount = amount - commission;

  const transaction = {
    id: 'TXN_' + Date.now(),
    serviceId,
    serviceTitle: service.title,
    clientId: req.user.userId,
    clientName: client.fullName,
    providerId: service.providerId,
    providerName: service.providerName,
    amount: parseInt(amount),
    commission: commission,
    providerAmount: providerAmount,
    operator,
    userNumber,
    confirmCode: confirmCode,
    status: 'waiting_payment',
    type: 'service_payment',
    createdAt: new Date()
  };

  transactions.push(transaction);

  // INSTRUCTIONS PAIEMENT RÉEL
  const operatorNumber = operator === 'mtn' ? '0166344282' : '0144110208';
  
  res.json({
    success: true,
    real_payment_required: true,
    message: '✅ Code validé ! Passez au paiement réel :',
    instructions: `💰 **INSTRUCTIONS DE PAIEMENT RÉEL**\n\n📱 **FAITES MAINTENANT :**\n\n1. 📞 **Dépôt Mobile Money** vers :\n   📟 ${operatorNumber}\n\n2. 💸 **Montant exact :** ${amount} FCFA\n\n3. 📝 **Référence :** Service-${serviceId}\n\n4. ✅ **Contactez-nous après paiement**\n\n📞 **Votre numéro de contact ici**\n\n🕒 **Activation sous 1h après confirmation**`,
    transaction: {
      id: transaction.id,
      amount: transaction.amount,
      status: transaction.status
    }
  });
});

app.post('/api/services/:id/complete', authenticateToken, (req, res) => {
  const serviceId = req.params.id;
  const service = services.find(s => s.id === serviceId);

  if (!service) {
    return res.status(404).json({ error: 'Service non trouvé' });
  }

  if (service.providerId !== req.user.userId && service.clientId !== req.user.userId) {
    return res.status(403).json({ error: 'Non autorisé' });
  }

  const transaction = transactions.find(t => t.serviceId === serviceId && t.status === 'completed');
  if (!transaction) {
    return res.status(400).json({ error: 'Transaction non trouvée' });
  }

  service.completed = true;
  service.status = 'completed';
  service.completedAt = new Date();
  service.updatedAt = new Date();

  const provider = users.find(u => u.id === service.providerId);
  if (provider) {
    provider.completedServices += 1;
    const newRating = Math.min(5.0, provider.rating + 0.1);
    provider.rating = parseFloat(newRating.toFixed(1));
  }

  io.emit('serviceCompleted', {
    serviceId: serviceId,
    serviceTitle: service.title,
    providerName: service.providerName,
    clientName: service.clientName,
    completedAt: service.completedAt
  });

  res.json({ 
    success: true, 
    service,
    message: 'Service marqué comme terminé avec succès'
  });
});

// Routes Messagerie
app.get('/api/conversations', authenticateToken, (req, res) => {
  const userConversations = conversations.filter(conv => 
    conv.participants.includes(req.user.userId)
  );

  const conversationsWithDetails = userConversations.map(conv => {
    const otherParticipantId = conv.participants.find(id => id !== req.user.userId);
    const otherUser = users.find(u => u.id === otherParticipantId);
    const lastMessage = messages
      .filter(m => m.conversationId === conv.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    const unreadCount = messages.filter(m => 
      m.conversationId === conv.id && 
      m.senderId !== req.user.userId && 
      !m.read
    ).length;

    return {
      id: conv.id,
      otherUser: {
        id: otherUser?.id,
        fullName: otherUser?.fullName,
        phone: otherUser?.phone,
        rating: otherUser?.rating,
        isOnline: otherUser?.isOnline || false
      },
      service: services.find(s => s.id === conv.serviceId),
      lastMessage: lastMessage,
      unreadCount: unreadCount,
      createdAt: conv.createdAt,
      updatedAt: lastMessage?.createdAt || conv.createdAt
    };
  });

  conversationsWithDetails.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  res.json(conversationsWithDetails);
});

app.get('/api/conversations/:conversationId/messages', authenticateToken, (req, res) => {
  const { conversationId } = req.params;
  
  const conversation = conversations.find(conv => conv.id === conversationId);
  if (!conversation || !conversation.participants.includes(req.user.userId)) {
    return res.status(403).json({ error: 'Conversation non trouvée' });
  }

  messages.forEach(message => {
    if (message.conversationId === conversationId && 
        message.senderId !== req.user.userId && 
        !message.read) {
      message.read = true;
      message.readAt = new Date();
    }
  });

  const conversationMessages = messages
    .filter(m => m.conversationId === conversationId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  res.json(conversationMessages);
});

app.post('/api/conversations', authenticateToken, (req, res) => {
  const { otherUserId, serviceId, initialMessage } = req.body;

  let conversation = conversations.find(conv =>
    conv.participants.includes(req.user.userId) &&
    conv.participants.includes(otherUserId) &&
    conv.serviceId === serviceId
  );

  if (!conversation) {
    conversation = {
      id: 'CONV_' + Date.now(),
      participants: [req.user.userId, otherUserId],
      serviceId: serviceId,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    conversations.push(conversation);
  }

  if (initialMessage) {
    const newMessage = {
      id: 'MSG_' + Date.now(),
      conversationId: conversation.id,
      senderId: req.user.userId,
      content: initialMessage,
      messageType: 'text',
      read: false,
      createdAt: new Date(),
      readAt: null
    };
    messages.push(newMessage);
    conversation.updatedAt = new Date();
  }

  res.json({ success: true, conversation });
});

// Routes Statistiques
app.get('/api/stats', authenticateToken, (req, res) => {
  const userTransactions = transactions.filter(t => 
    t.providerId === req.user.userId || t.clientId === req.user.userId
  );

  const userServices = services.filter(s => 
    s.providerId === req.user.userId || s.clientId === req.user.userId
  );

  const totalEarnings = userTransactions
    .filter(t => t.providerId === req.user.userId && t.status === 'completed')
    .reduce((sum, t) => sum + t.providerAmount, 0);

  const totalSpent = userTransactions
    .filter(t => t.clientId === req.user.userId && t.status === 'completed')
    .reduce((sum, t) => sum + t.amount, 0);

  const platformStats = {
    totalUsers: users.length,
    totalServices: services.length,
    activeServices: services.filter(s => s.status === 'active').length,
    completedServices: services.filter(s => s.completed).length,
    totalTransactions: transactions.filter(t => t.status === 'completed').length,
    totalCommission: transactions
      .filter(t => t.status === 'completed')
      .reduce((sum, t) => sum + t.commission, 0),
    pendingTransactions: transactions.filter(t => t.status === 'pending').length
  };

  const userStats = {
    totalEarnings,
    totalSpent,
    completedServicesAsProvider: services.filter(s => 
      s.providerId === req.user.userId && s.completed
    ).length,
    completedServicesAsClient: services.filter(s => 
      s.clientId === req.user.userId && s.completed
    ).length,
    activeServicesAsProvider: services.filter(s => 
      s.providerId === req.user.userId && s.status === 'in_progress'
    ).length,
    activeServicesAsClient: services.filter(s => 
      s.clientId === req.user.userId && s.status === 'in_progress'
    ).length,
    unreadMessages: messages.filter(m => 
      m.senderId !== req.user.userId && !m.read &&
      conversations.find(c => c.id === m.conversationId)?.participants.includes(req.user.userId)
    ).length
  };

  res.json({
    platform: platformStats,
    user: userStats
  });
});

// WebSocket
io.on('connection', (socket) => {
  console.log('🔌 Utilisateur connecté:', socket.id);

  socket.on('joinUserRoom', (userId) => {
    socket.join(`user_${userId}`);
    console.log(`👤 Utilisateur ${userId} a rejoint sa room`);
    
    const user = users.find(u => u.id === userId);
    if (user) {
      user.isOnline = true;
      user.lastSeen = new Date();
    }
  });

  socket.on('joinConversation', (conversationId) => {
    socket.join(conversationId);
    console.log(`💬 Socket ${socket.id} a rejoint la conversation ${conversationId}`);
  });

  socket.on('sendMessage', (data) => {
    const { conversationId, content, senderId } = data;

    const newMessage = {
      id: 'MSG_' + Date.now(),
      conversationId,
      senderId,
      content,
      messageType: 'text',
      read: false,
      createdAt: new Date(),
      readAt: null
    };

    messages.push(newMessage);

    const conversation = conversations.find(c => c.id === conversationId);
    if (conversation) {
      conversation.updatedAt = new Date();
    }

    io.to(conversationId).emit('newMessage', newMessage);

    const otherParticipants = conversation.participants.filter(id => id !== senderId);
    otherParticipants.forEach(participantId => {
      io.to(`user_${participantId}`).emit('conversationUpdate', {
        conversationId,
        lastMessage: newMessage
      });
    });
  });

  socket.on('disconnect', () => {
    console.log('🔌 Utilisateur déconnecté:', socket.id);
  });
});

// Route pour servir l'application
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Démarrer le serveur
server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🚀 SERVICE BENIN - PLATEFORME COMPLÈTE');
  console.log('='.repeat(50));
  console.log(`📍 Site web: http://localhost:${PORT}`);
  console.log(`🔗 API: http://localhost:${PORT}/api`);
  console.log(`📱 MTN Mobile Money: 0166344282`);
  console.log(`📱 Celtis Money: 0144110208`);
  console.log(`💰 Commission: 10% sur chaque transaction`);
  console.log(`🔐 Codes vérification: 2024 ou 1234`);
  console.log('='.repeat(50));
});