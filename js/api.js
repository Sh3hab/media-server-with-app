// ==================== نظام API المتكامل ====================
const API = {
  baseUrl: '',
  
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = localStorage.getItem('token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers
    });

    const data = await response.json();
    if (!response.ok) {
      throw data;
    }
    return data;
  },

  auth: {
    createGuest: (username) => API.request('/api/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ username })
    }),
    verify: () => API.request('/api/auth/verify')
  },

  watch: {
    saveProgress: (data) => API.request('/api/watch/progress', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    getProgress: (contentId) => API.request(`/api/watch/progress/${contentId}`),
    addToWatchlist: (data) => API.request('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    removeFromWatchlist: (contentId) => API.request(`/api/watchlist/${contentId}`, {
      method: 'DELETE'
    })
  },

  user: {
    getWatchlist: () => API.request('/api/watchlist'),
    getHistory: () => API.request('/api/watch/history'),
    getCollections: () => API.request('/api/collections')
  },

  subtitles: {
    get: (contentId) => API.request(`/api/subtitles/${contentId}`),
    upload: (formData) => API.request('/api/subtitles/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
      body: formData
    })
  },

  share: {
    create: (data) => API.request('/api/share', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  },

  content: {
    get: (id) => API.request(`/api/series/${id}`),
    getEpisodes: (seriesId, seasonId) => 
      API.request(`/api/episodes?seriesId=${seriesId}${seasonId ? `&seasonId=${seasonId}` : ''}`),
    getActors: (contentId) => API.request(`/api/content/${contentId}/actors`)
  },

  search: {
    all: (query) => API.request(`/api/search?q=${encodeURIComponent(query)}`),
    movies: (query) => API.request(`/api/search?q=${encodeURIComponent(query)}&type=movies`),
    series: (query) => API.request(`/api/search?q=${encodeURIComponent(query)}&type=series`),
    actors: (query) => API.request(`/api/search?q=${encodeURIComponent(query)}&type=actors`)
  }
};