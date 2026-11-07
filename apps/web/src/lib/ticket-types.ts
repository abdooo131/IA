export interface TicketRow {
  id: string;
  number: string;
  title: string;
  priority: 'normal' | 'urgent';
  status: 'open' | 'answered' | 'closed';
  createdBy: string;
  assignee: string;
  dueAt: string;
  readAt: string | null;
  answeredAt: string | null;
  messages: number;
  createdAt: string;
}

export interface TicketList {
  rows: TicketRow[];
  unread: number;
  slack: boolean;
}

export interface TicketDetail {
  id: string;
  number: string;
  title: string;
  priority: 'normal' | 'urgent';
  status: 'open' | 'answered' | 'closed';
  relatedType: string | null;
  relatedId: string | null;
  dueAt: string;
  readAt: string | null;
  answeredAt: string | null;
  closedAt: string | null;
  createdAt: string;
  inSlack: boolean;
  createdBy: { id: string; name: string; role: string };
  assignee: { id: string; name: string; role: string; inSlack: boolean };
  messages: {
    id: string;
    authorName: string;
    mine: boolean;
    source: 'app' | 'slack';
    body: string;
    at: string;
  }[];
}

export interface Assignee {
  id: string;
  name: string;
  role: string;
  slackUserId: string | null;
}
