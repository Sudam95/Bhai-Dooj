// memories.js
// Local, database-free configuration for the Bhai Dooj memory showcase.
//
// Files go in the /public folder:
//   public/memories/01.jpg, 02.jpg, 03.jpg
//   public/audio/01.mp3,   02.mp3,   03.mp3
//
// `date` can be 'YYYY-MM-DD' (shown as "November 3, 2024") or any plain text.
// Replace the dates below with the real ones when you know them.
//
// `position` is [x, y, z]. The three cards sit a little below the centre of
// the screen so the "Bhai Dooj" heading has room above them.

export const memories = [
  {
    id: 'm1',
    title: 'The Lamp She Lit',
    date: 'Bhai Dooj',
    description:
      'The flame was small, but it lit up the whole room. She carried the thali across with both hands, so careful not to let it flicker, and I just sat there, quiet, feeling how lucky I was. Some blessings come as a smile and a little lamp.',
    image: '/memories/01.jpg',
    bgMusic: '/audio/01.mp3',
    position: [-3.5, -0.45, -0.3],
  },
  {
    id: 'm2',
    title: 'Blessings on My Forehead',
    date: 'Bhai Dooj',
    description:
      'Sitting cross-legged on the floor, head slightly bowed, while a gentle hand rested on my forehead. The rangoli, the little lamp, the sweets on the thali. Nothing was said out loud, and nothing needed to be.',
    image: '/memories/02.jpg',
    bgMusic: '/audio/02.mp3',
    position: [0, -0.8, 0.5],
  },
  {
    id: 'm3',
    title: 'Together, Side by Side',
    date: 'Bhai Dooj',
    description:
      'One after another we sat in a row, waiting for our turn with the tika. A steady lamp on the floor, a few shy smiles and a lot of noise before and after. A simple morning I would happily live again.',
    image: '/memories/03.jpg',
    bgMusic: '/audio/03.mp3',
    position: [3.5, -0.5, -0.2],
  },
]

export default memories
