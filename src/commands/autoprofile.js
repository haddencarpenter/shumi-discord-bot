import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const query = (text, params) => pool.query(text, params);

export const data = new SlashCommandBuilder()
  .setName('autoprofile')
  .setDescription('Enable/disable Shumi auto-profile in this channel')
  .addStringOption(o => o.setName('state').setDescription('on or off').setRequired(true)
    .addChoices({name:'on', value:'on'}, {name:'off', value:'off'}))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction) {
  const enabled = interaction.options.getString('state') === 'on';
  await query(`
    INSERT INTO channel_settings (channel_id, autoprofile_enabled)
    VALUES ($1, $2)
    ON CONFLICT (channel_id) DO UPDATE SET autoprofile_enabled=EXCLUDED.autoprofile_enabled, updated_at=NOW()
  `, [interaction.channelId, enabled]);
  
  await interaction.reply({ 
    content: `Auto-profile **${enabled ? 'enabled' : 'disabled'}** for <#${interaction.channelId}>.`, 
    ephemeral: true 
  });
}