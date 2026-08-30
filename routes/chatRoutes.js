const express = require('express');
const router = express.Router();
const {
  getOrCreateConversation,
  getMyConversations,
  getUnreadCount,
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  markDelivered,
  markRead,
} = require('../controllers/chatController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/conversations', getOrCreateConversation);
router.get('/conversations', getMyConversations);
router.get('/unread-count', getUnreadCount);
router.get('/conversations/:id/messages', getMessages);
router.post('/conversations/:id/messages', sendMessage);
router.patch('/conversations/:id/messages/:messageId', editMessage);
router.delete('/conversations/:id/messages/:messageId', deleteMessage);
router.post('/conversations/:id/mark-delivered', markDelivered);
router.post('/conversations/:id/mark-read', markRead);

module.exports = router;
