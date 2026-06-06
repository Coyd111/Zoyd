import React from 'react';
import { Outlet } from 'react-router';
import ToastContainer from '../components/notifications/ToastContainer';

const RootLayout: React.FC = () => {
  return (
    <>
      <Outlet />
      <ToastContainer />
    </>
  );
};

export default RootLayout;
