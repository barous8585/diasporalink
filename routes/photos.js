// ── GET /api/photos/:id ── image (équipe, ou client lié au colis)
const router = require('express').Router();
const Photo = require('../models/Photo');
const Colis = require('../models/Colis');
const { auth } = require('../middleware/auth');
const { ah } = require('../utils/http');
const { lieAuCompte } = require('../services/colisService');

router.get('/:id', auth, ah(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).end();
  const photo = await Photo.findById(req.params.id).select('+donnees');
  if (!photo) return res.status(404).json({ succes: false, message: 'Photo introuvable.' });
  const colis = photo.colis ? await Colis.findById(photo.colis) : null;
  if (!lieAuCompte(colis, req.user)) return res.status(403).json({ succes: false, message: 'Accès refusé.' });
  res.setHeader('Content-Type', photo.mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(photo.donnees);
}));

module.exports = router;
