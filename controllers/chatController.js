const asyncHandler = require('express-async-handler');
const supabase = require('../utils/supabase');
const VendorProfile = require('../models/VendorProfile');
const User = require('../models/User');

const EDIT_DELETE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function assertParticipant(conversation, user) {
  if (user.role === 'admin' && conversation.type === 'support') return true;
  if (String(conversation.participant_a_id) === String(user._id)) return true;
  if (conversation.participant_b_id && String(conversation.participant_b_id) === String(user._id)) return true;
  return false;
}

// @desc    Find or create a conversation.
//          Customer/vendor: { type: 'vendor_customer', vendorUserId, productId? }
//                            or { type: 'support' } (talks to support in general)
//          Admin only:      { type: 'support', targetUserId } — admin proactively
//                            messaging a specific vendor/customer. The target
//                            becomes participant_a so the thread shows up in
//                            their own conversation list exactly like one they
//                            started themselves.
// @route   POST /api/chat/conversations
// @access  Private
const getOrCreateConversation = asyncHandler(async (req, res) => {
  const { type, vendorUserId, productId, targetUserId } = req.body;

  if (!['vendor_customer', 'support'].includes(type)) {
    res.status(400);
    throw new Error("type must be 'vendor_customer' or 'support'");
  }

  let participantAId = String(req.user._id);
  let participantARole = req.user.role;

  if (req.user.role === 'admin') {
    if (type !== 'support' || !targetUserId) {
      res.status(400);
      throw new Error('Admin can only start support conversations with a targetUserId');
    }
    const target = await User.findById(targetUserId).select('role');
    if (!target) {
      res.status(404);
      throw new Error('Target user not found');
    }
    participantAId = String(targetUserId);
    participantARole = target.role;
  }

  let query = supabase.from('conversations').select('*').eq('type', type).eq('participant_a_id', participantAId);

  if (type === 'vendor_customer') {
    if (!vendorUserId) {
      res.status(400);
      throw new Error('vendorUserId is required for a vendor_customer conversation');
    }
    query = query.eq('participant_b_id', String(vendorUserId));
    if (productId) query = query.eq('product_id', String(productId));
  }

  const { data: existing, error: findError } = await query.maybeSingle();
  if (findError) throw findError;
  if (existing) return res.json(existing);

  const { data: created, error: createError } = await supabase
    .from('conversations')
    .insert({
      type,
      participant_a_id: participantAId,
      participant_a_role: participantARole,
      participant_b_id: type === 'vendor_customer' ? String(vendorUserId) : null,
      product_id: productId ? String(productId) : null,
    })
    .select()
    .single();

  if (createError) throw createError;
  res.status(201).json(created);
});

// @desc    List the logged-in user's conversations, sorted by most recent
//          activity (not creation date), with a last-message preview.
// @route   GET /api/chat/conversations
// @access  Private
const getMyConversations = asyncHandler(async (req, res) => {
  let query = supabase.from('conversations').select('*');

  if (req.user.role === 'admin') {
    query = query.eq('type', 'support');
  } else {
    query = query.or(`participant_a_id.eq.${req.user._id},participant_b_id.eq.${req.user._id}`);
  }

  const { data: conversations, error } = await query;
  if (error) throw error;
  if (conversations.length === 0) return res.json([]);

  const ids = conversations.map((c) => c.id);

  // Bounded to the 500 most recent messages across all conversations —
  // unbounded here was the actual cause of the app feeling slow: it grew
  // proportionally to total message history, not to what's actually
  // needed (only the latest message and recent-unread state matter for
  // a conversation list).
  const { data: allMessages } = await supabase
    .from('messages')
    .select('conversation_id, content, created_at, sender_id, read_at')
    .in('conversation_id', ids)
    .order('created_at', { ascending: false })
    .limit(500);

  const lastMessageByConvo = {};
  const unreadByConvo = {};
  (allMessages || []).forEach((m) => {
    if (!lastMessageByConvo[m.conversation_id]) lastMessageByConvo[m.conversation_id] = m;
    if (String(m.sender_id) !== String(req.user._id) && !m.read_at) {
      unreadByConvo[m.conversation_id] = (unreadByConvo[m.conversation_id] || 0) + 1;
    }
  });

  // Batch-fetch every Mongo user/vendor name needed, instead of one lookup
  // per conversation (the other half of the N+1 fix).
  const otherIds = new Set();
  conversations.forEach((c) => {
    if (c.type === 'vendor_customer') {
      otherIds.add(String(c.participant_a_id) === String(req.user._id) ? c.participant_b_id : c.participant_a_id);
    } else if (req.user.role === 'admin') {
      otherIds.add(c.participant_a_id);
    }
  });

  const users = await User.find({ _id: { $in: Array.from(otherIds) } }).select('name');
  const userNameById = {};
  users.forEach((u) => (userNameById[String(u._id)] = u.name));

  const vendorProfiles = await VendorProfile.find({ user: { $in: Array.from(otherIds) } }).select('user storeName');
  const storeNameByUserId = {};
  vendorProfiles.forEach((v) => (storeNameByUserId[String(v.user)] = v.storeName));

  const enriched = conversations
    .map((c) => {
      let otherPartyName = 'Support';
      if (c.type === 'vendor_customer') {
        const otherId = String(c.participant_a_id) === String(req.user._id) ? c.participant_b_id : c.participant_a_id;
        otherPartyName = storeNameByUserId[otherId] || userNameById[otherId] || 'Unknown';
      } else if (req.user.role !== 'admin') {
        otherPartyName = 'KoboBuy Support';
      } else {
        otherPartyName = userNameById[c.participant_a_id] || 'User';
      }

      return {
        ...c,
        otherPartyName,
        lastMessage: lastMessageByConvo[c.id]?.content || null,
        lastMessageAt: lastMessageByConvo[c.id]?.created_at || c.created_at,
        unreadCount: unreadByConvo[c.id] || 0,
      };
    })
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

  res.json(enriched);
});

// @desc    Total unread message count across all the user's conversations
//          (for the navbar badge)
// @route   GET /api/chat/unread-count
// @access  Private
const getUnreadCount = asyncHandler(async (req, res) => {
  let convQuery = supabase.from('conversations').select('id');
  if (req.user.role === 'admin') {
    convQuery = convQuery.eq('type', 'support');
  } else {
    convQuery = convQuery.or(`participant_a_id.eq.${req.user._id},participant_b_id.eq.${req.user._id}`);
  }
  const { data: conversations } = await convQuery;
  const ids = (conversations || []).map((c) => c.id);
  if (ids.length === 0) return res.json({ count: 0 });

  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('conversation_id', ids)
    .neq('sender_id', String(req.user._id))
    .is('read_at', null);

  res.json({ count: count || 0 });
});

// @desc    Get the message history for a conversation
// @route   GET /api/chat/conversations/:id/messages
// @access  Private
const getMessages = asyncHandler(async (req, res) => {
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (convError || !conversation) {
    res.status(404);
    throw new Error('Conversation not found');
  }
  if (!(await assertParticipant(conversation, req.user))) {
    res.status(403);
    throw new Error('Not authorized to view this conversation');
  }

  const { data: messages, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', req.params.id)
    .order('created_at', { ascending: true });

  if (error) throw error;
  res.json(messages);
});

// @desc    Send a message in a conversation
// @route   POST /api/chat/conversations/:id/messages
// @access  Private
const sendMessage = asyncHandler(async (req, res) => {
  const { content, replyToMessageId } = req.body;
  if (!content || !content.trim()) {
    res.status(400);
    throw new Error('Message content is required');
  }

  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (convError || !conversation) {
    res.status(404);
    throw new Error('Conversation not found');
  }
  if (!(await assertParticipant(conversation, req.user))) {
    res.status(403);
    throw new Error('Not authorized to post in this conversation');
  }

  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: req.params.id,
      sender_id: String(req.user._id),
      sender_role: req.user.role,
      content: content.trim(),
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (error) throw error;
  res.status(201).json(message);
});

// @desc    Mark specific messages as delivered — called by the RECIPIENT'S
//          browser the instant it receives them over realtime. Meaning:
//          "this reached the other person's device," same as WhatsApp's
//          single-tick-to-double-tick transition.
// @route   POST /api/chat/conversations/:id/mark-delivered
// @access  Private
const markDelivered = asyncHandler(async (req, res) => {
  const { messageIds } = req.body;
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    res.status(400);
    throw new Error('messageIds must be a non-empty array');
  }

  const { error } = await supabase
    .from('messages')
    .update({ delivered_at: new Date().toISOString() })
    .in('id', messageIds)
    .eq('conversation_id', req.params.id)
    .neq('sender_id', String(req.user._id)) // can't mark your own messages delivered
    .is('delivered_at', null);

  if (error) throw error;
  res.json({ message: 'Marked delivered' });
});

// @desc    Mark every unread message from the other party as read — called
//          when the recipient actually has this conversation open.
// @route   POST /api/chat/conversations/:id/mark-read
// @access  Private
const markRead = asyncHandler(async (req, res) => {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString(), delivered_at: new Date().toISOString() })
    .eq('conversation_id', req.params.id)
    .neq('sender_id', String(req.user._id))
    .is('read_at', null);

  if (error) throw error;
  res.json({ message: 'Marked read' });
});

// @desc    Edit a message — sender only, within 1 hour of sending
// @route   PATCH /api/chat/conversations/:id/messages/:messageId
// @access  Private
const editMessage = asyncHandler(async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    res.status(400);
    throw new Error('Message content is required');
  }

  const { data: message, error: findError } = await supabase
    .from('messages')
    .select('*')
    .eq('id', req.params.messageId)
    .eq('conversation_id', req.params.id)
    .single();

  if (findError || !message) {
    res.status(404);
    throw new Error('Message not found');
  }
  if (String(message.sender_id) !== String(req.user._id)) {
    res.status(403);
    throw new Error('You can only edit your own messages');
  }
  if (message.deleted_at) {
    res.status(400);
    throw new Error('Cannot edit a deleted message');
  }
  if (Date.now() - new Date(message.created_at).getTime() > EDIT_DELETE_WINDOW_MS) {
    res.status(400);
    throw new Error('This message can no longer be edited — the 1 hour window has passed');
  }

  const { data: updated, error } = await supabase
    .from('messages')
    .update({ content: content.trim(), edited_at: new Date().toISOString() })
    .eq('id', req.params.messageId)
    .select()
    .single();

  if (error) throw error;
  res.json(updated);
});

// @desc    Delete a message (soft delete) — sender only, within 1 hour
// @route   DELETE /api/chat/conversations/:id/messages/:messageId
// @access  Private
const deleteMessage = asyncHandler(async (req, res) => {
  const { data: message, error: findError } = await supabase
    .from('messages')
    .select('*')
    .eq('id', req.params.messageId)
    .eq('conversation_id', req.params.id)
    .single();

  if (findError || !message) {
    res.status(404);
    throw new Error('Message not found');
  }
  if (String(message.sender_id) !== String(req.user._id)) {
    res.status(403);
    throw new Error('You can only delete your own messages');
  }
  if (Date.now() - new Date(message.created_at).getTime() > EDIT_DELETE_WINDOW_MS) {
    res.status(400);
    throw new Error('This message can no longer be deleted — the 1 hour window has passed');
  }

  // Soft delete: content is actually cleared server-side (not just hidden
  // client-side), so an "unsent" message isn't sitting recoverable in a
  // network response — the frontend renders the deleted_at placeholder.
  const { data: updated, error } = await supabase
    .from('messages')
    .update({ content: '', deleted_at: new Date().toISOString() })
    .eq('id', req.params.messageId)
    .select()
    .single();

  if (error) throw error;
  res.json(updated);
});

module.exports = {
  getOrCreateConversation,
  getMyConversations,
  getUnreadCount,
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  markDelivered,
  markRead,
};
