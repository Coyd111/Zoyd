import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import { formatZC } from '../../lib/utils';

interface TrendPoint {
  day: string;
  amount: number;
  label?: string;
}

interface MatchResult {
  name: string;
  value: number;
  color: string;
}

const tooltipStyle = {
  backgroundColor: '#0A0A0A',
  border: '1px solid rgba(255,255,255,0.1)',
  fontSize: '12px',
  fontFamily: 'monospace',
};

export const EarningsAreaChart: React.FC<{ data: TrendPoint[] }> = ({ data }) => (
  <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={data}>
      <defs>
        <linearGradient id="earningsArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#FFCC00" stopOpacity={0.3} />
          <stop offset="95%" stopColor="#FFCC00" stopOpacity={0} />
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
      <XAxis dataKey="day" stroke="#ffffff20" fontSize={10} fontFamily="monospace" tickLine={false} axisLine={false} />
      <YAxis stroke="#ffffff20" fontSize={10} fontFamily="monospace" tickLine={false} axisLine={false} tickFormatter={(value) => `${value}ZC`} />
      <Tooltip
        contentStyle={tooltipStyle}
        formatter={(value: number, _name, payload) => [formatZC(value), payload?.payload?.label || 'Jour']}
        labelFormatter={(_value, payload) => payload?.[0]?.payload?.label || ''}
      />
      <Area type="monotone" dataKey="amount" stroke="#FFCC00" strokeWidth={3} fillOpacity={1} fill="url(#earningsArea)" />
    </AreaChart>
  </ResponsiveContainer>
);

export const MatchResultsBarChart: React.FC<{ data: MatchResult[] }> = ({ data }) => (
  <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data}>
      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
      <XAxis dataKey="name" stroke="#ffffff20" fontSize={10} fontFamily="monospace" axisLine={false} tickLine={false} />
      <YAxis hide />
      <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={tooltipStyle} />
      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
        {data.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={entry.color} />
        ))}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);
