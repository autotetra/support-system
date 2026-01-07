import React, { useEffect, useState, useRef } from "react";
import api from "../api";
import CreateUserForm from "./CreateUserForm";
import CreateTicketForm from "./CreateTicketForm";
import io from "socket.io-client";

interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "Admin" | "Agent" | "User";
  departments: string[];
  createdAt: string;
}

interface TicketUserRef {
  _id: string;
  firstName: string;
  lastName: string;
}

interface Ticket {
  _id: string;
  title: string;
  status: string;
  priority: string;
  category: string;
  description?: string;
  createdBy?: TicketUserRef;
  assignee?: TicketUserRef | null;
  createdAt: string;

  comments?: {
    body: string;
    createdAt: string;
    author?: { email?: string };
  }[];
}

interface Props {
  name: string;
}

// You can move these to a separate config file later if you want
const DEPARTMENT_OPTIONS = ["Technical", "Billing", "General"];
const STATUS_OPTIONS = ["Open", "In Progress", "Closed"];
const PRIORITY_OPTIONS = ["Low", "Medium", "High"];
const CATEGORY_OPTIONS = ["Technical", "Billing", "General"];

const AdminDashboard: React.FC<Props> = ({ name }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showCreateTicket, setShowCreateTicket] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const MAX_COMMENTS_FOR_AI = 5;

  // ---- editing state: USERS ----
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userEdits, setUserEdits] = useState<Partial<User>>({});

  // ---- editing state: TICKETS ----
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [newComment, setNewComment] = useState("");
  const [ticketEdits, setTicketEdits] = useState<
    Partial<Ticket> & { assigneeId?: string | null }
  >({});

  const [showTicketModal, setShowTicketModal] = useState(false);

  const [socket, setSocket] = useState<any>(null);

  // =======================
  // FETCHING
  // =======================

  const fetchUsers = async () => {
    try {
      const res = await api.get<User[]>("/users");
      setUsers(res.data);
    } catch (err) {
      console.error("Failed to fetch users", err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchTickets = async () => {
    try {
      const res = await api.get<Ticket[]>("/tickets");
      const freshTickets = res.data;

      // 1. update list
      setTickets(freshTickets);

      // 2. if modal is open, keep selectedTicket in sync
      setSelectedTicket((prev) => {
        if (!prev) return prev;

        const updated = freshTickets.find((t) => t._id === prev._id);
        if (!updated) return null; // ticket deleted

        // merge so we keep comments from prev, but update basic fields
        return {
          ...prev,
          ...updated,
        };
      });
    } catch (err) {
      console.error("Failed to fetch tickets", err);
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchTickets();
  }, []);

  // =======================
  // SOCKET SETUP
  // =======================

  useEffect(() => {
    const s = io("http://localhost:5050", {
      withCredentials: true,
    } as any);

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socket) return;

    // New tickets → refresh list
    socket.on("ticketCreated", fetchTickets);

    // When a ticket updates (title, description, status, priority, assignee, comments)
    socket.on("ticketUpdated", (updated: Ticket) => {
      // Update table
      setTickets((prev) =>
        prev.map((t) => (t._id === updated._id ? updated : t))
      );

      // Update modal if open
      setSelectedTicket((prev) =>
        prev && prev._id === updated._id ? updated : prev
      );
    });

    // When a ticket is deleted
    socket.on("ticketDeleted", (ticketId: string) => {
      fetchTickets();

      // Close modal if the open ticket was deleted
      if (selectedTicket && selectedTicket._id === ticketId) {
        setSelectedTicket(null);
        setShowTicketModal(false);
      }
    });

    return () => {
      socket.off("ticketCreated", fetchTickets);
      socket.off("ticketUpdated");
      socket.off("ticketDeleted");
    };
  }, [socket, selectedTicket]);

  // ---- helpers ----
  const agents = users.filter((u) => u.role === "Agent");
  const adminCount = users.filter((u) => u.role === "Admin").length;
  const isLastAdmin = (u: User) => u.role === "Admin" && adminCount === 1;

  // =======================
  // USER ACTIONS
  // =======================

  const handleDeleteUser = async (id: string) => {
    const target = users.find((u) => u._id === id);
    if (!target) return;

    if (isLastAdmin(target)) {
      alert("You cannot delete the last Admin user.");
      return;
    }

    if (!window.confirm("Delete this user?")) return;

    try {
      await api.delete(`/users/${id}`);
      setUsers((prev) => prev.filter((u) => u._id !== id));
    } catch (err) {
      console.error("Delete user error", err);
      alert("Failed to delete user");
    }
  };

  const startEditUser = (u: User) => {
    setEditingUserId(u._id);
    setUserEdits({
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      role: u.role,
      departments: [...u.departments],
    });
  };

  const cancelEditUser = () => {
    setEditingUserId(null);
    setUserEdits({});
  };

  const handleUserFieldChange = (field: keyof User, value: any) => {
    setUserEdits((prev) => ({ ...prev, [field]: value }));
  };

  const handleUserDepartmentsChange = (
    e: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
    handleUserFieldChange("departments", selected);
  };

  const saveUser = async () => {
    if (!editingUserId) return;

    const payload: Partial<User> = {
      firstName: userEdits.firstName,
      lastName: userEdits.lastName,
      email: userEdits.email,
      role: userEdits.role,
      // if role is Agent, keep selected departments; else clear them
      departments:
        userEdits.role === "Agent"
          ? (userEdits.departments as string[]) || []
          : [],
    };

    try {
      const res = await api.patch<User>(`/users/${editingUserId}`, payload);
      const updated = res.data;
      setUsers((prev) =>
        prev.map((u) => (u._id === updated._id ? updated : u))
      );
      setEditingUserId(null);
      setUserEdits({});
    } catch (err) {
      console.error("Update user error", err);
      alert("Failed to update user");
    }
  };

  // =======================
  // TICKET ACTIONS
  // =======================

  const handleDeleteTicket = async (id: string) => {
    if (!window.confirm("Delete this ticket?")) return;

    try {
      await api.delete(`/tickets/${id}`);
      setTickets((prev) => prev.filter((t) => t._id !== id));
    } catch (err) {
      console.error("Delete ticket error", err);
      alert("Failed to delete ticket");
    }
  };

  const startEditTicket = (t: Ticket) => {
    setEditingTicketId(t._id);
    setTicketEdits({
      title: t.title,
      description: t.description || "",
      status: t.status,
      priority: t.priority,
      category: t.category,
      assigneeId: t.assignee?._id || "",
    });
  };

  const cancelEditTicket = () => {
    setEditingTicketId(null);
    setTicketEdits({});
  };

  const handleTicketFieldChange = (
    field: keyof Ticket,
    value: string | null
  ) => {
    setTicketEdits((prev) => ({ ...prev, [field]: value as any }));
  };

  const saveTicket = async () => {
    if (!editingTicketId) return;

    const payload: any = {
      title: ticketEdits.title,
      description: ticketEdits.description,
      status: ticketEdits.status,
      priority: ticketEdits.priority,
      category: ticketEdits.category,
      assignee: ticketEdits.assigneeId || null,
    };

    try {
      const res = await api.patch<Ticket>(
        `/tickets/${editingTicketId}`,
        payload
      );
      const updated = res.data;
      setTickets((prev) =>
        prev.map((t) => (t._id === updated._id ? updated : t))
      );
      setEditingTicketId(null);
      setTicketEdits({});
    } catch (err) {
      console.error("Update ticket error", err);
      alert("Failed to update ticket");
    }
  };

  const openTicket = async (t: Ticket) => {
    try {
      const res = await api.get<Ticket>(`/tickets/${t._id}`);
      setSelectedTicket(res.data as Ticket);
      setNewComment("");
      setShowTicketModal(true);
    } catch (err) {
      console.error("Failed to load ticket details", err);
      alert("Failed to load ticket details");
    }
  };

  const handleAddComment = async () => {
    if (!selectedTicket || !newComment.trim()) return;

    try {
      const res = await api.post(`/tickets/${selectedTicket._id}/comments`, {
        body: newComment,
      });

      setSelectedTicket(res.data as Ticket); // updated ticket with new comments
      setNewComment("");
    } catch (err) {
      console.error("Failed to add comment", err);
      alert("Failed to add comment");
    }
  };

  // ---------------------------------------------------
  // SUGGEST REPLY USING AI
  // ---------------------------------------------------
  const handleSuggestReply = async () => {
    if (!selectedTicket) return;

    setAiError("");
    setAiLoading(true);

    try {
      const res = await api.post<{ suggestion: string }>("/ai/suggest-reply", {
        ticketId: selectedTicket._id,
        maxComments: MAX_COMMENTS_FOR_AI,
      });

      const suggestion = res.data?.suggestion ?? "";
      setNewComment(suggestion);

      // focus textarea so admin can edit immediately
      setTimeout(() => commentRef.current?.focus(), 0);
    } catch (err) {
      console.error("Suggest reply failed:", err);
      setAiError("Failed to generate suggestion");
    } finally {
      setAiLoading(false);
    }
  };
  // =======================
  // RENDER
  // =======================

  return (
    <div>
      <h2>Welcome, Admin {name}</h2>

      {/* USER MANAGEMENT */}
      <h3>User Management</h3>
      <button onClick={() => setShowCreateUser(true)}>Create New User</button>

      {showCreateUser && (
        <div>
          <CreateUserForm
            onClose={() => setShowCreateUser(false)}
            onCreated={fetchUsers}
          />
        </div>
      )}

      {loadingUsers ? (
        <p>Loading users...</p>
      ) : (
        <table border={1} cellPadding={4}>
          <thead>
            <tr>
              <th>First Name</th>
              <th>Last Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Departments</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {users.map((u) => {
              const isEditing = editingUserId === u._id;
              const isLast = isLastAdmin(u);

              return (
                <tr key={u._id}>
                  {/* FIRST NAME */}
                  <td>
                    {isEditing ? (
                      <input
                        value={userEdits.firstName ?? ""}
                        onChange={(e) =>
                          handleUserFieldChange("firstName", e.target.value)
                        }
                      />
                    ) : (
                      u.firstName
                    )}
                  </td>

                  {/* LAST NAME */}
                  <td>
                    {isEditing ? (
                      <input
                        value={userEdits.lastName ?? ""}
                        onChange={(e) =>
                          handleUserFieldChange("lastName", e.target.value)
                        }
                      />
                    ) : (
                      u.lastName
                    )}
                  </td>

                  {/* EMAIL */}
                  <td>
                    {isEditing ? (
                      <input
                        value={userEdits.email ?? ""}
                        onChange={(e) =>
                          handleUserFieldChange("email", e.target.value)
                        }
                      />
                    ) : (
                      u.email
                    )}
                  </td>

                  {/* ROLE */}
                  <td>
                    {isEditing ? (
                      <select
                        value={userEdits.role ?? u.role}
                        onChange={(e) =>
                          handleUserFieldChange(
                            "role",
                            e.target.value as User["role"]
                          )
                        }
                      >
                        <option value="Admin">Admin</option>
                        <option value="Agent">Agent</option>
                        <option value="User">User</option>
                      </select>
                    ) : (
                      u.role
                    )}
                  </td>

                  {/* DEPARTMENTS (multi-select when Agent) */}
                  <td>
                    {isEditing ? (
                      userEdits.role === "Agent" ? (
                        <select
                          multiple
                          value={(userEdits.departments as string[]) || []}
                          onChange={handleUserDepartmentsChange}
                          style={{ minWidth: "120px" }}
                        >
                          {DEPARTMENT_OPTIONS.map((dep) => (
                            <option key={dep} value={dep}>
                              {dep}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span>-</span>
                      )
                    ) : u.departments.length ? (
                      u.departments.join(", ")
                    ) : (
                      "-"
                    )}
                  </td>

                  {/* CREATED AT */}
                  <td>{new Date(u.createdAt).toLocaleString()}</td>

                  {/* ACTIONS */}
                  <td>
                    {isEditing ? (
                      <>
                        <button onClick={saveUser} style={{ marginRight: 4 }}>
                          Save
                        </button>
                        <button onClick={cancelEditUser}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEditUser(u)}
                          style={{ marginRight: 4 }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u._id)}
                          disabled={isLast}
                          title={
                            isLast
                              ? "You cannot delete the last Admin."
                              : undefined
                          }
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* TICKET MANAGEMENT */}
      <h3>All Tickets</h3>

      <button onClick={() => setShowCreateTicket(true)}>
        Create New Ticket
      </button>

      {showCreateTicket && (
        <div>
          <CreateTicketForm
            users={users}
            onClose={() => setShowCreateTicket(false)}
            onCreated={fetchTickets}
          />
        </div>
      )}

      {loadingTickets ? (
        <p>Loading tickets...</p>
      ) : (
        <table border={1} cellPadding={4}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Category</th>
              <th>Created By</th>
              <th>Assignee</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {tickets.map((t) => {
              const isEditing = editingTicketId === t._id;

              return (
                <tr key={t._id}>
                  {/* TITLE */}
                  <td>
                    {isEditing ? (
                      <input
                        value={ticketEdits.title ?? t.title}
                        onChange={(e) =>
                          handleTicketFieldChange("title", e.target.value)
                        }
                      />
                    ) : (
                      t.title
                    )}
                  </td>

                  {/* STATUS */}
                  <td>
                    {isEditing ? (
                      <select
                        value={ticketEdits.status ?? t.status}
                        onChange={(e) =>
                          handleTicketFieldChange("status", e.target.value)
                        }
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    ) : (
                      t.status
                    )}
                  </td>

                  {/* PRIORITY */}
                  <td>
                    {isEditing ? (
                      <select
                        value={ticketEdits.priority ?? t.priority}
                        onChange={(e) =>
                          handleTicketFieldChange("priority", e.target.value)
                        }
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    ) : (
                      t.priority
                    )}
                  </td>

                  {/* CATEGORY */}
                  <td>
                    {isEditing ? (
                      <select
                        value={ticketEdits.category ?? t.category}
                        onChange={(e) =>
                          handleTicketFieldChange("category", e.target.value)
                        }
                      >
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    ) : (
                      t.category
                    )}
                  </td>

                  {/* CREATED BY */}
                  <td>
                    {t.createdBy
                      ? `${t.createdBy.firstName} ${t.createdBy.lastName}`
                      : "-"}
                  </td>

                  {/* ASSIGNEE */}
                  <td>
                    {isEditing ? (
                      <select
                        value={ticketEdits.assigneeId ?? t.assignee?._id ?? ""}
                        onChange={(e) =>
                          setTicketEdits((prev) => ({
                            ...prev,
                            assigneeId: e.target.value || "",
                          }))
                        }
                      >
                        <option value="">None</option>
                        {agents.map((a) => (
                          <option key={a._id} value={a._id}>
                            {a.firstName} {a.lastName}
                          </option>
                        ))}
                      </select>
                    ) : t.assignee ? (
                      `${t.assignee.firstName} ${t.assignee.lastName}`
                    ) : (
                      "-"
                    )}
                  </td>

                  {/* CREATED AT */}
                  <td>{new Date(t.createdAt).toLocaleString()}</td>

                  {/* ACTIONS */}
                  <td>
                    {isEditing ? (
                      <>
                        <button onClick={saveTicket} style={{ marginRight: 4 }}>
                          Save
                        </button>
                        <button onClick={cancelEditTicket}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEditTicket(t)}
                          style={{ marginRight: 4 }}
                        >
                          Edit
                        </button>

                        <button
                          onClick={() => openTicket(t)}
                          style={{ marginRight: 4 }}
                        >
                          Open
                        </button>

                        <button onClick={() => handleDeleteTicket(t._id)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* OLD DETAILS PANEL (non-modal) */}
      {selectedTicket && !showTicketModal && (
        <div style={{ border: "1px solid #ccc", padding: 16, marginTop: 20 }}>
          <h3>Ticket Details</h3>

          <p>
            <strong>Title:</strong> {selectedTicket.title}
          </p>
          <p>
            <strong>Description:</strong>{" "}
            {selectedTicket.description ?? "(no description)"}
          </p>
          <p>
            <strong>Status:</strong> {selectedTicket.status}
          </p>
          <p>
            <strong>Priority:</strong> {selectedTicket.priority}
          </p>
          <p>
            <strong>Category:</strong> {selectedTicket.category}
          </p>
          <p>
            <strong>Created:</strong>{" "}
            {new Date(selectedTicket.createdAt).toLocaleString()}
          </p>

          <h4>Comments</h4>
          <ul>
            {selectedTicket.comments?.map((c, i) => (
              <li key={i}>
                <strong>{c.author?.email ?? "Unknown"}:</strong> {c.body}
                <br />
                <small>{new Date(c.createdAt).toLocaleString()}</small>
              </li>
            ))}
          </ul>

          <button onClick={() => setSelectedTicket(null)}>Close</button>
        </div>
      )}

      {/* MODAL DETAILS */}
      {showTicketModal && selectedTicket && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "white",
              padding: "20px",
              borderRadius: "8px",
              width: "600px",
              maxHeight: "80vh",
              overflowY: "auto",
            }}
          >
            <h2>Ticket Details</h2>

            <p>
              <strong>Title:</strong> {selectedTicket.title}
            </p>
            <p>
              <strong>Description:</strong>{" "}
              {selectedTicket.description ?? "(no description)"}
            </p>
            <p>
              <strong>Status:</strong> {selectedTicket.status}
            </p>
            <p>
              <strong>Priority:</strong> {selectedTicket.priority}
            </p>
            <p>
              <strong>Category:</strong> {selectedTicket.category}
            </p>
            <p>
              <strong>Created:</strong>{" "}
              {new Date(selectedTicket.createdAt).toLocaleString()}
            </p>

            <h3>Comments</h3>

            {selectedTicket.comments && selectedTicket.comments.length > 0 ? (
              <ul>
                {selectedTicket.comments.map((c: any) => (
                  <li key={c._id} style={{ marginBottom: "10px" }}>
                    <strong>{c.author?.email || "Unknown user"}: </strong>
                    <p style={{ margin: "3px 0" }}>{c.body}</p>
                    <small>{new Date(c.createdAt).toLocaleString()}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No comments yet.</p>
            )}

            <textarea
              ref={commentRef}
              placeholder="Write a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={3}
              style={{ width: "100%", marginTop: "10px" }}
            />

            <div style={{ marginTop: "10px" }}>
              <button
                onClick={handleSuggestReply}
                disabled={aiLoading || !selectedTicket}
                style={{ marginRight: "10px" }}
              >
                {aiLoading ? "Generating..." : "Suggest Reply"}
              </button>

              <button onClick={handleAddComment} disabled={aiLoading}>
                Add Comment
              </button>
            </div>

            {aiError && <p style={{ color: "red" }}>{aiError}</p>}

            <br />

            <button
              onClick={() => {
                setSelectedTicket(null);
                setShowTicketModal(false);
              }}
              style={{ marginTop: "20px" }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
