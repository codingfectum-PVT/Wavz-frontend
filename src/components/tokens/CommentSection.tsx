'use client';

import { FC, useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { MessageCircle, Send, Heart, Reply, Trash2, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { formatTimeAgo, shortenAddress } from '@/lib/utils';
import { useSocket } from '@/components/providers/SocketProvider';
import toast from 'react-hot-toast';
import { AppLoader } from '../Apploader';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface CommentAuthor {
  address: string;
  createdAt: string;
}

interface Comment {
  id: string;
  content: string;
  authorAddress: string;
  author: CommentAuthor;
  parentId: string | null;
  likes: number;
  createdAt: string;
  replies?: Comment[];
  _count: {
    replies: number;
    likedBy: number;
  };
}

interface CommentSectionProps {
  mint: string;
}

export const CommentSection: FC<CommentSectionProps> = ({ mint }) => {
  const { publicKey } = useWallet();
  const { socket, connected } = useSocket();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // Fetch comments
  const fetchComments = useCallback(async (pageNum: number = 1) => {
    try {
      const res = await fetch(`${API_URL}/api/comments/${mint}?page=${pageNum}&limit=20`);
      const data = await res.json();
      
      if (pageNum === 1) {
        setComments(data.comments);
      } else {
        setComments(prev => [...prev, ...data.comments]);
      }
      
      setHasMore(data.pagination.page < data.pagination.pages);
    } catch (error) {
      console.error('Error fetching comments:', error);
      toast.error('Failed to load comments');
    } finally {
      setLoading(false);
    }
  }, [mint]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // WebSocket listeners for real-time updates
  useEffect(() => {
    if (!socket || !connected) return;

    const handleNewComment = (data: { mint: string; comment: Comment }) => {
      if (data.mint === mint && !data.comment.parentId) {
        setComments(prev => [data.comment, ...prev]);
      }
    };

    const handleCommentReply = (data: { mint: string; comment: Comment; parentId: string }) => {
      if (data.mint === mint) {
        setComments(prev => prev.map(comment => {
          if (comment.id === data.parentId) {
            return {
              ...comment,
              replies: [...(comment.replies || []), data.comment],
              _count: {
                ...comment._count,
                replies: comment._count.replies + 1,
              },
            };
          }
          return comment;
        }));
      }
    };

    const handleCommentLike = (data: { mint: string; commentId: string; likes: number }) => {
      if (data.mint === mint) {
        setComments(prev => prev.map(comment => {
          if (comment.id === data.commentId) {
            return { ...comment, likes: data.likes };
          }
          // Check in replies
          if (comment.replies) {
            return {
              ...comment,
              replies: comment.replies.map(reply =>
                reply.id === data.commentId ? { ...reply, likes: data.likes } : reply
              ),
            };
          }
          return comment;
        }));
      }
    };

    socket.on('comment:new', handleNewComment);
    socket.on('comment:reply', handleCommentReply);
    socket.on('comment:like', handleCommentLike);

    return () => {
      socket.off('comment:new', handleNewComment);
      socket.off('comment:reply', handleCommentReply);
      socket.off('comment:like', handleCommentLike);
    };
  }, [socket, connected, mint]);

  // Submit new comment
  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!publicKey) {
      toast.error('Please connect your wallet to comment');
      return;
    }
    
    if (!newComment.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/comments/${mint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newComment.trim(),
          authorAddress: publicKey.toBase58(),
        }),
      });

      if (!res.ok) throw new Error('Failed to post comment');

      setNewComment('');
      toast.success('Comment posted!');
    } catch (error) {
      toast.error('Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  };

  // Submit reply
  const handleSubmitReply = async (parentId: string) => {
    if (!publicKey) {
      toast.error('Please connect your wallet to reply');
      return;
    }
    
    if (!replyContent.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/comments/${mint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: replyContent.trim(),
          authorAddress: publicKey.toBase58(),
          parentId,
        }),
      });

      if (!res.ok) throw new Error('Failed to post reply');

      setReplyContent('');
      setReplyingTo(null);
      toast.success('Reply posted!');
    } catch (error) {
      toast.error('Failed to post reply');
    } finally {
      setSubmitting(false);
    }
  };

  // Like comment
  const handleLike = async (commentId: string) => {
    if (!publicKey) {
      toast.error('Please connect your wallet to like');
      return;
    }

    try {
      await fetch(`${API_URL}/api/comments/${commentId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: publicKey.toBase58() }),
      });
    } catch (error) {
      toast.error('Failed to like comment');
    }
  };

  // Delete comment
  const handleDelete = async (commentId: string) => {
    if (!publicKey) return;

    try {
      const res = await fetch(`${API_URL}/api/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: publicKey.toBase58() }),
      });

      if (!res.ok) throw new Error('Failed to delete');

      setComments(prev => prev.filter(c => c.id !== commentId));
      toast.success('Comment deleted');
    } catch (error) {
      toast.error('Failed to delete comment');
    }
  };

  // Toggle replies visibility
  const toggleReplies = (commentId: string) => {
    setExpandedComments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(commentId)) {
        newSet.delete(commentId);
      } else {
        newSet.add(commentId);
      }
      return newSet;
    });
  };

  // Load more comments
  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchComments(nextPage);
  };

  // Render single comment
  const renderComment = (comment: Comment, isReply: boolean = false) => {
    const isAuthor = publicKey?.toBase58() === comment.authorAddress;
    const hasReplies = comment._count?.replies > 0 || (comment.replies && comment.replies.length > 0);
    const isExpanded = expandedComments.has(comment.id);

    return (
      <div
        key={comment.id}
        className={`${isReply ? 'ml-8 border-l-2 border-gray-700 pl-4' : ''}`}
      >
        <div className="rounded-xl border border-[#1f3a59] bg-[#0d2138] p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <a
                href={`/profile/${comment.authorAddress}`}
                className="font-medium text-[#7bc6ff] hover:underline"
              >
                {shortenAddress(comment.authorAddress, 4)}
              </a>
              <span className="text-sm text-[#8fa4bb]">
                {formatTimeAgo(new Date(comment.createdAt).getTime())}
              </span>
            </div>
            {isAuthor && (
              <button
                onClick={() => handleDelete(comment.id)}
                className="text-[#8fa4bb] transition-colors hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Content */}
          <p className="break-words whitespace-pre-wrap text-[#d8e5f1]">{comment.content}</p>

          {/* Actions */}
          <div className="flex items-center space-x-4 mt-3">
            <button
              onClick={() => handleLike(comment.id)}
              className="flex items-center space-x-1 text-[#8fa4bb] transition-colors hover:text-red-400"
            >
              <Heart className="w-4 h-4" />
              <span className="text-sm">{comment.likes || comment._count?.likedBy || 0}</span>
            </button>
            {!isReply && (
              <button
                onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                className="flex items-center space-x-1 text-[#8fa4bb] transition-colors hover:text-[#7bc6ff]"
              >
                <Reply className="w-4 h-4" />
                <span className="text-sm">Reply</span>
              </button>
            )}
            {!isReply && hasReplies && (
              <button
                onClick={() => toggleReplies(comment.id)}
                className="flex items-center space-x-1 text-[#8fa4bb] transition-colors hover:text-white"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    <span className="text-sm">Hide replies</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    <span className="text-sm">
                      {comment._count?.replies || comment.replies?.length || 0} replies
                    </span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Reply Form */}
          {replyingTo === comment.id && (
            <div className="mt-4">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={replyContent}
                  onChange={e => setReplyContent(e.target.value)}
                  placeholder="Write a reply..."
                  className="flex-1 rounded-lg border border-[#2d4867] bg-[#14263d] px-4 py-2 text-white placeholder:text-[#8fa4bb] focus:outline-none focus:ring-1 focus:ring-[#45ef56]"
                  maxLength={500}
                />
                <button
                  onClick={() => handleSubmitReply(comment.id)}
                  disabled={submitting || !replyContent.trim()}
                  className="rounded-lg bg-[#45ef56] px-4 py-2 text-[#08172A] transition-colors hover:bg-[#39da4c] disabled:cursor-not-allowed disabled:bg-[#3d4b5d]"
                >
                  {submitting ? (
                    <AppLoader size={50}/>
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Replies */}
        {isExpanded && comment.replies && comment.replies.length > 0 && (
          <div className="mt-2 space-y-2">
            {comment.replies.map(reply => renderComment(reply, true))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-[#1f3a59] bg-[#08172A] p-6">
        <div className="flex items-center justify-center py-8">
          <AppLoader size={50}/>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#1f3a59] bg-[#08172A] p-6">
      <h3 className="mb-4 flex items-center text-xl font-bold">
        <MessageCircle className="w-5 h-5 mr-2" />
        Comments ({comments.length})
      </h3>

      {/* New Comment Form */}
      <form onSubmit={handleSubmitComment} className="mb-6">
        <div className="flex space-x-2">
          <input
            type="text"
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            placeholder={publicKey ? "Write a comment..." : "Connect wallet to comment"}
            disabled={!publicKey}
            className="flex-1 rounded-lg border border-[#2d4867] bg-[#14263d] px-4 py-3 text-white placeholder:text-[#8fa4bb] focus:outline-none focus:ring-1 focus:ring-[#45ef56] disabled:cursor-not-allowed disabled:opacity-50"
            maxLength={500}
          />
          <button
            type="submit"
            disabled={submitting || !publicKey || !newComment.trim()}
            className="rounded-lg bg-[#4a5a6f] px-6 py-3 text-white transition-colors hover:bg-[#5b6e86] disabled:cursor-not-allowed disabled:bg-[#3d4b5d]"
          >
            {submitting ? (
              <AppLoader size={50}  />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
        <p className="mt-1 text-xs text-[#8fa4bb]">{newComment.length}/500 characters</p>
      </form>

      {/* Comments List */}
      <div className="space-y-4">
        {comments.length === 0 ? (
          <div className="py-8 text-center text-[#8fa4bb]">
            <MessageCircle className="mx-auto mb-2 h-12 w-12 opacity-50" />
            <p>No comments yet. Be the first to comment!</p>
          </div>
        ) : (
          <>
            {comments.map(comment => renderComment(comment))}
            
            {hasMore && (
              <button
                onClick={loadMore}
                className="w-full py-3 text-primary-400 hover:text-primary-300 transition-colors"
              >
                Load more comments
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
