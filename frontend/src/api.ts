import axios from "axios";

/**
 * Central Axios instance for API communication.
 * - Uses HTTP-only cookies for auth (withCredentials)
 * - Base URL is controlled via environment variable
 */
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL,
  withCredentials: true,
});

export default api;
