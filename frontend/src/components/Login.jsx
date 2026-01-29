import React, { useState } from "react";
import axios from "axios";
import minecraftLogo from "../assets/minecraft-logo-8.png";
import '../styles/Login.css';
import { apiUrl } from '../config/api';

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(apiUrl('/login'), { email, password });
      localStorage.setItem("jwtToken", response.data.token);
      onLogin();
    } catch (error) {
      console.error("Login error:", error);
      alert("Login failed. Please check your credentials.");
    }
  };

  return (
    <div className="login-container">
      <img src={minecraftLogo} alt="Minecraft Logo" className="logo" />
      <div className="login-box">
        <div className="login-text">
          <h2>Hunter's Guild Login</h2>
          <p>Welcome back, adventurer! Please log in to continue.</p>
        </div>
        <div className="login-form">
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input-field"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="input-field"
            />
            <button type="submit" className="login-btn">Login</button>
          </form>
        </div>
      </div>

      {/* Particle Animation Elements for Login Component */}
      <div className="particles-login">
        <div className="particle-login"></div>
        <div className="particle-login"></div>
        <div className="particle-login"></div>
        <div className="particle-login"></div>
        <div className="particle-login"></div>
        <div className="particle-login"></div>
      </div>
    </div>
  );
}

export default Login;
