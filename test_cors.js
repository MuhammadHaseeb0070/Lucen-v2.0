const isLocalDevOrigin = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin);

const testOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://localhost:5173',
    'http://127.0.0.1:5173',
    'http://192.168.1.5:5174',
    'http://10.0.0.1:3000',
    'http://172.16.0.1:5000',
    'https://192.168.1.5:5174',
    'http://google.com',
    'https://lucen.space',
    'http://localhost.com'
];

testOrigins.forEach(origin => {
    console.log(`${origin.padEnd(25)}: ${isLocalDevOrigin(origin)}`);
});
