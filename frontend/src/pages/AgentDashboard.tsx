import React, { useEffect, useState, useRef } from "react";
import api from "../api";
import io from "socket.io-client";

type Comment = {
  _id: string;
  body: string;
  createdAt: string;
  author?: {
    email?: string;
  } | null;
};

type Ticket = {
  _id: string;
  title: string;
  description?: string;
  status: "Open" | "In Progress" | "Closed";
  category: "Billing" | "Technical" | "General";
  priority: "Low" | "Medium" | "High";
  createdBy: any;
  assignee: any;
  createdAt: string;
  comments?: Comment[];
};

interface AgentDashboardProps {
  name: string;
}

const AgentDashboard: React.FC<AgentDashboardProps> = ({ name }) => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [socket, setSocket] = useState<any>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const MAX_COMMENTS_FOR_AI = 5;

  const [editPriority, setEditPriority] = useState<"Low" | "Medium" | "High">(
    "Medium"
  );
  const [editStatus, setEditStatus] = useState<
    "Open" | "In Progress" | "Closed"
  >("Open");

  const [newComment, setNewComment] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const commentRef = useRef<HTMLTextAreaElement | null>(null);

  // ---------------------------------------------------
  // SOCKET CONNECTION
  // ---------------------------------------------------
  useEffect(() => {
    const s = io("http://localhost:5050", {
      withCredentials: true,
    } as any);

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  // ---------------------------------------------------
  // FETCH TICKETS (list)
  // ---------------------------------------------------
  const fetchTickets = async () => {
    try {
      const res = await api.get<Ticket[]>("/tickets");
      setTickets(res.data);
    } catch (err) {
      console.error("Error fetching tickets:", err);
    }
  };

  // ---------------------------------------------------
  // FETCH FULL POPULATED TICKET
  // ---------------------------------------------------
  const fetchFullTicket = async (id: string) => {
    try {
      const res = await api.get<Ticket>(`/tickets/${id}`);
      setSelectedTicket(res.data);
    } catch (err) {
      console.error("Failed to load full ticket:", err);
    }
  };

  // ---------------------------------------------------
  // SOCKET LISTENERS
  // ---------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const refreshList = () => fetchTickets();

    const handleSocketUpdate = (updated: Ticket) => {
      fetchTickets();

      setSelectedTicket((prev) => {
        if (!prev) return prev;

        // If ticket was open but unassigned → close it
        if (prev._id === updated._id && !updated.assignee) {
          return null;
        }

        if (prev._id === updated._id) {
          return updated;
        }

        return prev;
      });

      if (
        selectedTicket &&
        selectedTicket._id === updated._id &&
        updated.assignee
      ) {
        setEditPriority(updated.priority);
        setEditStatus(updated.status);
      }
    };

    const handleDelete = (ticketId: string) => {
      fetchTickets();
      setSelectedTicket((prev) =>
        prev && prev._id === ticketId ? null : prev
      );
    };

    socket.on("ticketCreated", refreshList);
    socket.on("ticketUpdated", handleSocketUpdate);
    socket.on("ticketDeleted", handleDelete);

    return () => {
      socket.off("ticketCreated", refreshList);
      socket.off("ticketUpdated", handleSocketUpdate);
      socket.off("ticketDeleted", handleDelete);
    };
  }, [socket, selectedTicket]);

  // Initial load
  useEffect(() => {
    fetchTickets();
  }, []);

  // ---------------------------------------------------
  // SELECT TICKET
  // ---------------------------------------------------
  const handleSelectTicket = async (t: Ticket) => {
    await fetchFullTicket(t._id);
    setEditPriority(t.priority);
    setEditStatus(t.status);
    setNewComment("");
  };

  // ---------------------------------------------------
  // SAVE CHANGES
  // ---------------------------------------------------
  const handleSave = async () => {
    if (!selectedTicket) return;

    try {
      const res = await api.patch(`/tickets/${selectedTicket._id}`, {
        priority: editPriority,
        status: editStatus,
      });

      const updated = res.data as Ticket;

      setTickets((prev) =>
        prev.map((t) => (t._id === updated._id ? updated : t))
      );

      setSelectedTicket(updated);
    } catch (err) {
      console.error("Failed to update ticket:", err);
      alert("Failed to update ticket");
    }
  };

  // ---------------------------------------------------
  // ADD COMMENT
  // ---------------------------------------------------
  const handleAddComment = async () => {
    if (!selectedTicket || !newComment.trim()) return;

    try {
      const res = await api.post(`/tickets/${selectedTicket._id}/comments`, {
        body: newComment,
      });

      setSelectedTicket(res.data as Ticket);
      setNewComment("");
    } catch (err) {
      console.error("Failed to add comment:", err);
      alert("Failed to add comment");
    }
  };
  // ---------------------------------------------------
  // SUGGEST REPLY USING AI
  // ---------------------------------------------------
  const handleSuggestReply = async () => {
    if (!selectedTicket) return;
    if (aiLoading) return;

    setAiError("");
    setAiLoading(true);

    try {
      const res = await api.post<{ suggestion: string }>(`/ai/suggest-reply`, {
        ticketId: selectedTicket._id,
        maxComments: MAX_COMMENTS_FOR_AI,
      });

      const suggestion = res.data?.suggestion ?? "";

      // Put suggestion into the comment box (agent can edit)
      setNewComment(suggestion);

      // Focus textarea so agent can immediately edit
      setTimeout(() => commentRef.current?.focus(), 0);
    } catch (err) {
      console.error("Suggest reply failed:", err);
      setAiError("Failed to generate suggestion");
    } finally {
      setAiLoading(false);
    }
  };
  // ---------------------------------------------------
  // RENDER
  // ---------------------------------------------------
  return (
    <div>
      <h2>Agent Dashboard</h2>
      <p>Welcome, {name}!</p>

      <h3>Assigned Tickets</h3>

      {tickets.length === 0 ? (
        <p>No assigned tickets.</p>
      ) : (
        <ul>
          {tickets.map((t) => (
            <li
              key={t._id}
              style={{ cursor: "pointer" }}
              onClick={() => handleSelectTicket(t)}
            >
              {t.title}
            </li>
          ))}
        </ul>
      )}

      {selectedTicket && (
        <div style={{ marginTop: "20px" }}>
          <h3>Ticket Details</h3>

          <p>
            <strong>Title:</strong> {selectedTicket.title}
          </p>
          <p>
            <strong>Description:</strong> {selectedTicket.description}
          </p>
          <p>
            <strong>Category:</strong> {selectedTicket.category}
          </p>

          <p>
            <strong>Priority:</strong>
            <select
              value={editPriority}
              onChange={(e) =>
                setEditPriority(e.target.value as "Low" | "Medium" | "High")
              }
              style={{ marginLeft: "10px" }}
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </p>

          <p>
            <strong>Status:</strong>
            <select
              value={editStatus}
              onChange={(e) =>
                setEditStatus(
                  e.target.value as "Open" | "In Progress" | "Closed"
                )
              }
              style={{ marginLeft: "10px" }}
            >
              <option value="Open">Open</option>
              <option value="In Progress">In Progress</option>
              <option value="Closed">Closed</option>
            </select>
          </p>

          <p>
            <strong>Created:</strong>{" "}
            {new Date(selectedTicket.createdAt).toLocaleString()}
          </p>

          <p>
            <strong>Created By:</strong>{" "}
            {selectedTicket.createdBy?.email || "Unknown user"}
          </p>

          <button onClick={handleSave} style={{ marginRight: "10px" }}>
            Save Changes
          </button>

          <h3>Comments</h3>

          <ul>
            {selectedTicket.comments?.map((c) => (
              <li key={c._id} style={{ marginBottom: "10px" }}>
                <strong>{c.author?.email || "Unknown user"}:</strong>
                <br />
                {c.body}
                <br />
                <small>{new Date(c.createdAt).toLocaleString()}</small>
              </li>
            ))}
          </ul>

          <textarea
            ref={commentRef}
            placeholder="Write a comment..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            style={{ width: "300px", height: "80px" }}
          />

          <br />

          <button onClick={handleSuggestReply} disabled={aiLoading}>
            {aiLoading ? "Generating..." : "Suggest Reply"}
          </button>

          {aiError && <p style={{ color: "red" }}>{aiError}</p>}

          <button onClick={handleAddComment} disabled={aiLoading}>
            Add Comment
          </button>

          <button onClick={() => setSelectedTicket(null)}>Close</button>
        </div>
      )}
    </div>
  );
};

export default AgentDashboard;
